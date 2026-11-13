import { loadPartyDirectory } from './partyIdentity.service';
import { Order } from '../models/Order';
import { StockSale } from '../models/StockSale';
import { StockRestock } from '../models/StockRestock';
import { PurchaseWarning } from '../models/PurchaseWarning';
import { Bayi } from '../models/Bayi';
import { ConflictError, ValidationError } from '../errors/HttpError';
import { ORDER_PRODUCT_TYPES } from '../constants/orderProducts.constant';
import type { StockSaleInput } from '../schemas/stock.schema';
import { Types } from 'mongoose';

type ProductType = keyof typeof ORDER_PRODUCT_TYPES;
type Product = {
	type: string;
	memoryGb?: number | null;
	quantityUnit?: string;
};
export type SupplierSale = {
	bayiId?: string | null;
	bayiName: string;
	quantity: number;
	revenue: number;
	costOfGoods: number;
};
export type StoredStockLine = Product & {
	bayiId?: string | null;
	costPolicy?: 'supplier-average' | null;
	suppliers?: SupplierSale[] | null;
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
	currentBayiName?: string | null;
	type: ProductType;
	memoryGb: number | null;
	quantityUnit: 'piece' | 'kg';
	quantity: number;
	remaining: number;
	remainingValue: number;
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
	const [legacySales, restocks, orders, parties] = await Promise.all([
		StockSale.find().lean(),
		StockRestock.find().lean(),
		Order.find().sort({ createdAt: 1, _id: 1 }).lean(),
		loadPartyDirectory(),
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
			bayiId: parties.purchases.get(String(order._id))?.bayiId ?? '',
			currentBayiName:
				parties.purchases.get(String(order._id))?.currentBayiName ?? null,
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
			remaining: 0,
			remainingValue: 0,
			unitPrice: normalizedPrice(line.unitPrice, line.quantityUnit),
			total: line.total,
			orderTotal: order.total,
			createdAt: order.createdAt,
		})),
	);
	const byId = new Map(lots.map((lot) => [lot.lotId, lot]));
	const pools = new Map<string, { quantity: number; value: number }>();
	const events = [
		...lots.map((lot) => ({ date: lot.createdAt, lot, sale: null })),
		...book.sales.map((sale) => ({ date: sale.createdAt, lot: null, sale })),
	].sort(
		(a, b) =>
			a.date.getTime() - b.date.getTime() ||
			Number(Boolean(b.lot)) - Number(Boolean(a.lot)),
	);
	const revalue = (rows: StockLot[], value: number) => {
		const remaining = rows.filter((lot) => lot.remaining > 0);
		const quantity = remaining.reduce((sum, lot) => sum + lot.remaining, 0);
		let left = rounded(value);
		remaining.forEach((lot, index) => {
			lot.remainingValue =
				index === remaining.length - 1
					? left
					: rounded((value * lot.remaining) / quantity);
			left = rounded(left - lot.remainingValue);
		});
		for (const lot of rows) if (lot.remaining <= 0) lot.remainingValue = 0;
	};
	for (const event of events) {
		if (event.lot) {
			event.lot.remaining = event.lot.quantity;
			event.lot.remainingValue = event.lot.total;
			continue;
		}
		const sale = event.sale!;
		const rows = lots.filter(
			(lot) =>
				stockProductKey(lot) === stockProductKey(sale) && lot.remaining > 0,
		);
		const beforeValue = rows.reduce((sum, lot) => sum + lot.remainingValue, 0);
		const supplierValues = new Map<string, number>();
		for (const lot of rows)
			supplierValues.set(
				lot.bayiId,
				(supplierValues.get(lot.bayiId) ?? 0) + lot.remainingValue,
			);
		for (const allocation of sale.allocations) {
			const lot = byId.get(allocation.lotId);
			if (lot) lot.remaining = rounded(lot.remaining - allocation.quantity);
		}
		if (sale.costPolicy === 'supplier-average' && sale.suppliers) {
			for (const supplier of sale.suppliers) {
				const id = supplier.bayiId ?? '';
				revalue(
					rows.filter((lot) => lot.bayiId === id),
					(supplierValues.get(id) ?? 0) - supplier.costOfGoods,
				);
			}
		} else revalue(rows, beforeValue - sale.costOfGoods);
	}
	for (const lot of lots) {
		const key = poolKey(lot);
		const pool = pools.get(key) ?? { quantity: 0, value: 0 };
		pool.quantity = rounded(pool.quantity + lot.remaining);
		pool.value = rounded(pool.value + lot.remainingValue);
		pools.set(key, pool);
	}
	return { book, lots, pools, parties };
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
			bayiId?: string | null;
		}[],
	) =>
		lines
			.map(
				(line) =>
					`${stockProductKey(line)}:${line.bayiId ?? '*'}:${rounded(normalizedQuantity(line.quantity, line.quantityUnit))}:${line.revenue}`,
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
				'Bu işlem kimliği farklı bir satışta kullanılmış.',
			);
		return { operation: existing, isNew: false };
	}
	const purchaseLinks = new Map<string, string>();
	const lines = input.lines.map((inputLine) => {
		const quantity = rounded(
			normalizedQuantity(inputLine.quantity, inputLine.quantityUnit),
		);
		const available = state.lots.filter(
			(lot) =>
				stockProductKey(lot) === stockProductKey(inputLine) &&
				(!inputLine.bayiId || lot.bayiId === inputLine.bayiId) &&
				lot.remaining > 0,
		);
		for (const lot of available)
			if (lot.bayiId) purchaseLinks.set(lot.orderId, lot.bayiId);
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
				`${label}: tüm stok satışında mevcut stoğun tamamı çıkılmalıdır.`,
			);
		// FIFO selects purchase lots within the explicitly selected supplier.
		let left = quantity;
		const allocations: { lotId: string; quantity: number }[] = [];
		for (const lot of available) {
			const take = Math.min(left, lot.remaining);
			if (take > 0)
				allocations.push({ lotId: lot.lotId, quantity: rounded(take) });
			left = rounded(left - take);
		}
		const supplierQuantities = new Map<string, number>();
		for (const allocation of allocations) {
			const lot = available.find((lot) => lot.lotId === allocation.lotId)!;
			supplierQuantities.set(
				lot.bayiId,
				rounded(
					(supplierQuantities.get(lot.bayiId) ?? 0) + allocation.quantity,
				),
			);
		}
		const parts = [...supplierQuantities].map(([id, quantity]) => {
			const rows = available.filter((lot) => lot.bayiId === id);
			const stock = rows.reduce((sum, lot) => sum + lot.remaining, 0);
			const value = rows.reduce((sum, lot) => sum + lot.remainingValue, 0);
			return {
				bayiId: id || null,
				bayiName: state.parties.bayi.currentName(id) ?? rows[0].bayiName,
				quantity,
				revenue: 0,
				costOfGoods: rounded((value / stock) * quantity),
			};
		});
		// Allocate integer cents without losing or inventing money on rounding.
		const cents = Math.round(inputLine.revenue * 100);
		const shares = parts.map((part, index) => ({
			index,
			exact: (cents * part.quantity) / quantity,
		}));
		let remaining = cents;
		for (const share of shares) {
			const floor = Math.floor(share.exact);
			parts[share.index].revenue = floor;
			remaining -= floor;
		}
		shares.sort((a, b) => (b.exact % 1) - (a.exact % 1) || a.index - b.index);
		for (let index = 0; index < remaining; index++)
			parts[shares[index % shares.length].index].revenue++;
		for (const part of parts) part.revenue /= 100;
		const costOfGoods = rounded(
			parts.reduce((sum, part) => sum + part.costOfGoods, 0),
		);
		const averagePurchaseCost = costOfGoods / quantity;
		return {
			...inputLine,
			quantityUnit: (inputLine.quantityUnit === 'piece' ? 'piece' : 'kg') as
				| 'piece'
				| 'kg',
			quantity,
			allocations,
			previousQuantity: totalAvailable,
			remainingQuantity: rounded(totalAvailable - quantity),
			costPolicy: 'supplier-average' as const,
			suppliers: parts,
			costOfGoods,
			averagePurchaseCost: rounded(averagePurchaseCost),
		};
	});
	// Freeze unambiguous purchase references used by this sale before aliases can be reused.
	if (purchaseLinks.size)
		await Order.bulkWrite(
			[...purchaseLinks].map(([id, bayiId]) => ({
				updateOne: {
					filter: { _id: new Types.ObjectId(id), bayiId: null },
					update: { $set: { bayiId: new Types.ObjectId(bayiId) } },
					timestamps: false,
				},
			})),
		);
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
	lines: (Product & { unitPrice: number; quantity?: number })[],
	comparisonDays = 30,
) {
	const now = Date.now();
	const since = now - comparisonDays * 86400000;
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
			(sale) =>
				stockProductKey(sale) === key &&
				sale.createdAt.getTime() >= since &&
				sale.createdAt.getTime() <= now,
		);
		const soldQuantity = sales.reduce((sum, sale) => sum + sale.quantity, 0);
		const sellingPrice =
			soldQuantity > 0
				? sales.reduce((sum, sale) => sum + sale.revenue, 0) / soldQuantity
				: undefined;
		const purchasePrice = normalizedPrice(line.unitPrice, line.quantityUnit);
		const product = ORDER_PRODUCT_TYPES[line.type as ProductType];
		const label = `${product.label}${product.requiresMemorySize ? ` ${line.memoryGb} GB` : ''} (${(line.quantity ?? 1).toLocaleString('tr-TR')} ${!line.quantityUnit || line.quantityUnit === 'piece' ? 'adet' : line.quantityUnit})`;
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
		const message = `${bayi.name} · ${label}: alış fiyatı (${purchasePrice.toLocaleString('tr-TR')} TL) son ${comparisonDays} günün ortalama satış fiyatından (${sellingPrice.toLocaleString('tr-TR')} TL) yüksek. Bu bayiden alım zarar ettirebilir.`;
		risks.push({ productKey: key, message, alreadyWarned: !firstClaim });
		if (firstClaim) warnings.push({ productKey: key, message });
	}
	return { warnings, risks, missingPrices };
}

export async function checkPurchaseWarnings(
	bayiId: string,
	lines: (Product & { unitPrice: number; quantity?: number })[],
	comparisonDays = 30,
) {
	return (await inspectPurchaseWarnings(bayiId, lines, comparisonDays))
		.warnings;
}
