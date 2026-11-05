import { Order } from '../models/Order';
import { StockSale } from '../models/StockSale';
import { StockRestock } from '../models/StockRestock';
import { PurchaseWarning } from '../models/PurchaseWarning';
import { Bayi } from '../models/Bayi';
import { ConflictError, ValidationError } from '../errors/HttpError';
import { ORDER_PRODUCT_TYPES } from '../constants/orderProducts.constant';
import type { StockSaleInput } from '../schemas/stock.schema';
import type { Types } from 'mongoose';

type ProductType = keyof typeof ORDER_PRODUCT_TYPES;
type Product = {
	type: string;
	memoryGb?: number | null;
	quantityUnit?: string;
};
export type StoredStockLine = Product & {
	quantityUnit: 'piece' | 'kg';
	quantity: number;
	revenue: number;
	costOfGoods: number;
	averagePurchaseCost: number;
	allocations: { lotId: string; quantity: number }[];
	previousQuantity?: number;
	remainingQuantity?: number;
};
export type StoredRestock = {
	requestId: string;
	mode: 'complete' | 'partial';
	lines: StoredStockLine[];
	totalRevenue: number;
	totalCostOfGoods: number;
	createdAt: Date;
	createdBy: Types.ObjectId;
};
export const stockProductKey = (p: Product) =>
	`${p.type}:${ORDER_PRODUCT_TYPES[p.type as ProductType]?.requiresMemorySize ? p.memoryGb : '-'}:${p.quantityUnit === 'piece' || !p.quantityUnit ? 'piece' : 'kg'}`;
const poolKey = stockProductKey;
const normalizedQuantity = (quantity: number, unit?: string) =>
	unit === 'g' ? quantity / 1000 : quantity;
const normalizedPrice = (price: number, unit?: string) =>
	unit === 'g' ? price * 1000 : price;
const rounded = (n: number, digits = 6) => Number(n.toFixed(digits));
export type StockLot = {
	lotId: string;
	orderId: string;
	bayiId: string;
	bayiName: string;
	type: ProductType;
	memoryGb: number | null;
	quantityUnit: 'piece' | 'kg';
	quantity: number;
	remaining: number;
	unitPrice: number;
	total: number;
	orderTotal: number;
	createdAt: Date;
};

// Match the server's standalone-Mongo, single-process write serialization
// (services/sync/version.service.ts). This queue holds no stock or warning state.
// A stock mutation is a single atomic sale insert, not multiple lot updates.
let saleQueue: Promise<unknown> = Promise.resolve();
export function withStockWrite<T>(write: () => Promise<T>): Promise<T> {
	const result = saleQueue.then(write);
	saleQueue = result.then(
		() => undefined,
		() => undefined,
	);
	return result;
}
export async function loadStock() {
	const [legacySales, restocks, orders] = await Promise.all([
		StockSale.find().lean(),
		StockRestock.find().lean(),
		Order.find().sort({ createdAt: 1, _id: 1 }).lean(),
	]);
	const operations: StoredRestock[] = [
		...legacySales.map((sale) => ({
			requestId: sale.requestId,
			mode: sale.mode,
			lines: [sale],
			totalRevenue: sale.revenue,
			totalCostOfGoods: sale.costOfGoods,
			createdAt: sale.createdAt,
			createdBy: sale.createdBy,
		})),
		...restocks,
	].sort(
		(a, b) =>
			a.createdAt.getTime() - b.createdAt.getTime() ||
			a.requestId.localeCompare(b.requestId),
	);
	const sales = operations.flatMap((operation) =>
		operation.lines.map((line) => ({
			...line,
			createdAt: operation.createdAt,
		})),
	);
	const book = { sales, operations };
	const lots: StockLot[] = orders.flatMap((order) =>
		order.lines.map((line, index) => ({
			// Older purchases can predate the required dealer-name snapshot.
			lotId: `${order._id}:${index}`,
			orderId: String(order._id),
			bayiId: String(order.bayiId ?? ''),
			bayiName: order.name ?? '',
			type: line.type as ProductType,
			memoryGb: ORDER_PRODUCT_TYPES[line.type as ProductType]
				?.requiresMemorySize
				? (line.memoryGb ?? null)
				: null,
			quantityUnit: (line.quantityUnit === 'piece' || !line.quantityUnit
				? 'piece'
				: 'kg') as 'piece' | 'kg',
			quantity: normalizedQuantity(line.quantity, line.quantityUnit),
			remaining: normalizedQuantity(line.quantity, line.quantityUnit),
			unitPrice: normalizedPrice(line.unitPrice, line.quantityUnit),
			total: line.total,
			orderTotal: order.total,
			createdAt: order.createdAt,
		})),
	);
	const byId = new Map(lots.map((lot) => [lot.lotId, lot]));
	const pools = new Map<string, { quantity: number; value: number }>();
	const movements = [
		...lots.map((lot) => ({
			key: poolKey(lot),
			date: lot.createdAt,
			quantity: lot.quantity,
			value: lot.total,
			incoming: true,
		})),
		...sales.map((sale) => ({
			key: poolKey(sale),
			date: sale.createdAt,
			quantity: sale.quantity,
			value: 0,
			incoming: false,
		})),
	].sort(
		(a, b) =>
			a.date.getTime() - b.date.getTime() ||
			Number(b.incoming) - Number(a.incoming),
	);
	for (const movement of movements) {
		const pool = pools.get(movement.key) ?? { quantity: 0, value: 0 };
		if (movement.incoming) {
			pool.quantity += movement.quantity;
			pool.value += movement.value;
		} else {
			const cost = pool.quantity > 0 ? pool.value / pool.quantity : 0;
			pool.quantity = rounded(pool.quantity - movement.quantity);
			pool.value =
				pool.quantity > 0 ? rounded(pool.value - cost * movement.quantity) : 0;
		}
		pools.set(movement.key, pool);
	}
	for (const sale of book.sales) {
		for (const entry of sale.allocations) {
			const lot = byId.get(entry.lotId);
			if (lot) lot.remaining = rounded(lot.remaining - entry.quantity);
		}
	}
	return { book, lots, pools };
}

async function insertStockSale(input: StockSaleInput, userId: string) {
	const state = await loadStock();
	const signature = (
		lines: {
			type: string;
			memoryGb?: number | null;
			quantityUnit?: string;
			quantity: number;
			revenue: number;
		}[],
	) =>
		lines
			.map(
				(line) =>
					`${stockProductKey(line)}:${rounded(normalizedQuantity(line.quantity, line.quantityUnit))}:${line.revenue}`,
			)
			.sort()
			.join('|');
	const existing = state.book.operations.find(
		(operation) => operation.requestId === input.requestId,
	);
	if (existing) {
		if (
			existing.mode !== input.mode ||
			signature(existing.lines) !== signature(input.lines)
		)
			throw new ConflictError(
				'Bu işlem kimliği farklı bir yenilemede kullanılmış.',
			);
		return { operation: existing, isNew: false };
	}
	const lines = input.lines.map((inputLine) => {
		const quantity = rounded(
			normalizedQuantity(inputLine.quantity, inputLine.quantityUnit),
		);
		const available = state.lots.filter(
			(lot) =>
				stockProductKey(lot) === stockProductKey(inputLine) &&
				lot.remaining > 0,
		);
		const totalAvailable = rounded(
			available.reduce((sum, lot) => sum + lot.remaining, 0),
		);
		const label = `${ORDER_PRODUCT_TYPES[inputLine.type].label}${inputLine.memoryGb === null ? '' : ` ${inputLine.memoryGb} GB`}`;
		if (quantity > totalAvailable + 0.0000001)
			throw new ValidationError(`${label}: miktar mevcut stoğu aşamaz.`);
		if (
			input.mode === 'complete' &&
			Math.abs(quantity - totalAvailable) > 0.0000001
		)
			throw new ValidationError(
				`${label}: tam yenilemede mevcut stoğun tamamı çıkılmalıdır.`,
			);
		// Internal FIFO maintains purchase history. Users enter product totals only;
		// this bookkeeping never implies supplier-specific sales or profit.
		let left = quantity;
		const allocations: { lotId: string; quantity: number }[] = [];
		for (const lot of available) {
			const take = Math.min(left, lot.remaining);
			if (take > 0)
				allocations.push({ lotId: lot.lotId, quantity: rounded(take) });
			left = rounded(left - take);
		}
		const pool = state.pools.get(poolKey(inputLine));
		if (!pool || pool.quantity <= 0)
			throw new ValidationError(`${label}: stok bulunamadı.`);
		const averagePurchaseCost = pool.value / pool.quantity;
		return {
			...inputLine,
			quantityUnit: (inputLine.quantityUnit === 'piece' ? 'piece' : 'kg') as
				| 'piece'
				| 'kg',
			quantity,
			allocations,
			previousQuantity: totalAvailable,
			remainingQuantity: rounded(totalAvailable - quantity),
			costOfGoods: rounded(averagePurchaseCost * quantity),
			averagePurchaseCost: rounded(averagePurchaseCost),
		};
	});
	// Validate every row before this single insert: a bad row cannot partially save.
	const operation = await StockRestock.create({
		_id: input.requestId,
		requestId: input.requestId,
		mode: input.mode,
		lines,
		totalRevenue: rounded(lines.reduce((sum, line) => sum + line.revenue, 0)),
		totalCostOfGoods: rounded(
			lines.reduce((sum, line) => sum + line.costOfGoods, 0),
		),
		createdAt: new Date(),
		createdBy: userId,
	});
	return { operation: operation.toObject(), isNew: true };
}
export function recordStockSale(input: StockSaleInput, userId: string) {
	return withStockWrite(() => insertStockSale(input, userId));
}

export async function inspectPurchaseWarnings(
	bayiId: string,
	lines: (Product & { unitPrice: number })[],
) {
	const [bayi, purchaseCount, state] = await Promise.all([
		Bayi.findById(bayiId).lean(),
		Order.countDocuments({ bayiId }),
		loadStock(),
	]);
	if (!bayi) throw new ValidationError('Bayi bulunamadı.');
	// Orders are immutable purchase records. Their persisted count is the cycle:
	// it advances on every successful save, including concurrent saves, and never
	// advances on a failed purchase. Keeping historical claims avoids a non-atomic
	// order-save + warning-reset write pair on standalone MongoDB.
	const cycle = String(purchaseCount);
	const warnings: { productKey: string; message: string }[] = [];
	const risks: {
		productKey: string;
		message: string;
		alreadyWarned: boolean;
	}[] = [];
	const missingPrices: string[] = [];
	const seen = new Set<string>();
	for (const line of lines) {
		const key = stockProductKey(line);
		const sales = state.book.sales.filter(
			(sale) => stockProductKey(sale) === key,
		);
		const soldQuantity = sales.reduce((sum, sale) => sum + sale.quantity, 0);
		const sellingPrice =
			soldQuantity > 0
				? sales.reduce((sum, sale) => sum + sale.revenue, 0) / soldQuantity
				: undefined;
		const purchasePrice = normalizedPrice(line.unitPrice, line.quantityUnit);
		const product = ORDER_PRODUCT_TYPES[line.type as ProductType];
		const label = `${product.label}${product.requiresMemorySize ? ` ${line.memoryGb} GB` : ''} (${line.quantityUnit === 'piece' ? 'adet' : 'kg'})`;
		if (sellingPrice === undefined) {
			if (!missingPrices.includes(label)) missingPrices.push(label);
			continue;
		}
		if (purchasePrice <= sellingPrice || seen.has(key)) continue;
		seen.add(key);
		let firstClaim = false;
		try {
			const result = await PurchaseWarning.updateOne(
				{ _id: `${bayiId}:${key}:${cycle}` },
				{
					$setOnInsert: {
						bayiId,
						productKey: key,
						purchaseCycle: cycle,
						triggeredAt: new Date(),
						purchasePrice,
						sellingPrice,
					},
				},
				{ upsert: true },
			);
			firstClaim = result.upsertedCount > 0;
		} catch (error) {
			if ((error as { code?: number }).code !== 11000) throw error;
		}
		const message = `${bayi.name} · ${label}: alış fiyatı (${purchasePrice.toLocaleString('tr-TR')} TL) satış fiyatından (${sellingPrice.toLocaleString('tr-TR')} TL) yüksek. Bu bayiden alım zarar ettirebilir.`;
		risks.push({ productKey: key, message, alreadyWarned: !firstClaim });
		if (firstClaim) warnings.push({ productKey: key, message });
	}
	return { warnings, risks, missingPrices };
}

export async function checkPurchaseWarnings(
	bayiId: string,
	lines: (Product & { unitPrice: number })[],
) {
	return (await inspectPurchaseWarnings(bayiId, lines)).warnings;
}
