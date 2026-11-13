import { stockActivityReport } from '../services/stockActivityReport.service';
import {
	matchesNumeric,
	productNumericValues,
	numericFieldsFor,
} from '../schemas/numericFilters.schema';
import type { Request, Response } from 'express';
import { orderQuerySchema } from '../schemas/order.schema';
import {
	stockSaleSchema,
	purchaseWarningSchema,
} from '../schemas/stock.schema';
import {
	inspectPurchaseWarnings,
	loadStock,
	recordStockSale,
	stockProductKey,
} from '../services/stock.service';
import { requireUserId } from './auth.helper';
import { handleHttpError } from '../errors/handleHttpError';
import logger from '../util/logger';
import { ValidationError, UnauthorizedError } from '../errors/HttpError';
import { User } from '../models/User';
import { LOG_ACTIONS, LOG_ENTITY_TYPES } from '../models/LogEvent';
import { recordLogEvent } from '../services/logEvents/recordLogEvent.service';
import { ORDER_PRODUCT_TYPES } from '../constants/orderProducts.constant';
import { loadPurchasePrices } from '../services/purchasePrices.service';
import {
	summarizeStockSales,
	summarizeSupplierSales,
} from '../services/stockReport.service';
import { z } from 'zod';

const reportFilters = z.object({
	excludeSaleIds: z
		.preprocess(
			(value) => (typeof value === 'string' ? value.split(',') : value),
			z.array(z.string().uuid()).max(5000),
		)
		.optional(),
	movementType: z.preprocess(
		(value) => {
			const names: Record<string, string> = {
				'all-movements': 'all',
				'purchase-entries': 'purchase',
				'all-sales': 'restock',
				'full-stock-sales': 'complete',
				'partial-sales': 'partial',
			};
			return typeof value === 'string' ? (names[value] ?? value) : value;
		},
		z
			.enum(['all', 'purchase', 'restock', 'complete', 'partial'])
			.default('all'),
	),
	productType: z.enum(['EMMC', 'EMCP', 'IPHONE', 'TABLET']).optional(),
	memoryGb: z.coerce.number().int().min(8).max(1024).optional(),
});

async function logActor(req: Request) {
	const adminId = requireUserId(req);
	const user = await User.findById(adminId).select('username').lean();
	if (!user) throw new UnauthorizedError();
	return { adminId, adminUsername: user.username };
}
const productLabel = (line: {
	type: string;
	memoryGb?: number | null;
	quantityUnit?: string;
}) =>
	`${ORDER_PRODUCT_TYPES[line.type as keyof typeof ORDER_PRODUCT_TYPES].label}${line.memoryGb == null ? '' : ` ${line.memoryGb} GB`} (${line.quantityUnit === 'piece' ? 'adet' : 'kg'})`;

export const getStock = async (req: Request, res: Response) => {
	try {
		const parsed = orderQuerySchema.safeParse(req.query);
		if (!parsed.success)
			throw new ValidationError(
				parsed.error.issues.map((issue) => issue.message).join(' '),
			);
		const query = parsed.data;
		const selectionResult = reportFilters.safeParse(req.query);
		if (!selectionResult.success)
			throw new ValidationError(
				selectionResult.error.issues.map((issue) => issue.message).join(' '),
			);
		const selection = selectionResult.data;
		if (
			query.numericFilters?.some(
				(f) => !numericFieldsFor('stock').includes(f.field),
			)
		)
			throw new ValidationError('Bu rapor için geçersiz sayı alanı.');
		const [state, listPurchasePrices] = await Promise.all([
			loadStock(),
			loadPurchasePrices(),
		]);
		const bayiIds = query.bayiIds?.length
			? query.bayiIds
			: query.bayiId
				? [query.bayiId]
				: [];
		const matchesProduct = (product: {
			type: string;
			memoryGb?: number | null;
		}) =>
			(!selection.productType || selection.productType === product.type) &&
			(!selection.memoryGb || selection.memoryGb === product.memoryGb);
		const from = query.from
			? new Date(`${query.from}T00:00:00+03:00`).getTime()
			: -Infinity;
		const until = query.until
			? new Date(`${query.until}T00:00:00+03:00`).getTime() + 86400000
			: Infinity;
		const inRange = (date: Date, total: number) =>
			date.getTime() >= from &&
			date.getTime() < until &&
			(query.minTotal === undefined || total >= query.minTotal) &&
			(query.maxTotal === undefined || total <= query.maxTotal);
		const filtered = state.lots.filter(
			(lot) =>
				matchesProduct(lot) &&
				(!bayiIds.length || bayiIds.includes(lot.bayiId)) &&
				(!query.bayiName ||
					lot.bayiName
						.toLocaleLowerCase('tr')
						.includes(query.bayiName.toLocaleLowerCase('tr'))) &&
				inRange(lot.createdAt, lot.orderTotal) &&
				matchesNumeric(
					query.numericFilters,
					{
						...productNumericValues(lot),
						total: lot.orderTotal,
					},
					lot,
				),
		);
		const matchingOperations = state.book.operations
			.filter(
				(operation) =>
					!query.bayiName &&
					selection.movementType !== 'purchase' &&
					(['all', 'restock'].includes(selection.movementType) ||
						selection.movementType === operation.mode) &&
					inRange(operation.createdAt, operation.totalRevenue),
			)
			.map((operation) => ({
				...operation,
				lines: operation.lines
					.flatMap((line) => {
						if (!bayiIds.length) return [line];
						const parts =
							line.suppliers?.filter(
								(part) => part.bayiId && bayiIds.includes(part.bayiId),
							) ?? [];
						if (!parts.length) return [];
						const quantity = parts.reduce(
								(sum, part) => sum + part.quantity,
								0,
							),
							revenue = parts.reduce((sum, part) => sum + part.revenue, 0),
							costOfGoods = parts.reduce(
								(sum, part) => sum + part.costOfGoods,
								0,
							);
						return [
							{
								...line,
								bayiId: parts.length === 1 ? parts[0].bayiId : null,
								quantity,
								revenue,
								costOfGoods,
								averagePurchaseCost: costOfGoods / quantity,
								suppliers: parts,
							},
						];
					})
					.filter(
						(line) =>
							matchesProduct(line) &&
							matchesNumeric(
								query.numericFilters,
								{
									...productNumericValues(line),
									total: operation.totalRevenue,
								},
								line,
							),
					),
			}))
			.filter((operation) => operation.lines.length > 0);
		const matchingSaleIds = matchingOperations.map(
			(operation) => operation.requestId,
		);
		const excludedSaleIds = new Set(selection.excludeSaleIds ?? []);
		const operations = matchingOperations.filter(
			(operation) => !excludedSaleIds.has(operation.requestId),
		);
		const sales = operations.flatMap((operation) =>
			operation.lines.map((line) => ({
				...line,
				createdAt: operation.createdAt,
			})),
		);
		const positions = [...new Set(state.lots.map(stockProductKey))].map(
			(key) => {
				const lots = state.lots.filter((lot) => stockProductKey(lot) === key);
				const first = lots[0];
				const pool = state.pools.get(key)!;
				const productSales = sales.filter(
					(sale) => stockProductKey(sale) === key,
				);
				const soldQuantity = productSales.reduce(
					(sum, sale) => sum + sale.quantity,
					0,
				);
				return {
					key,
					suppliers: [
						...new Set(
							lots.filter((lot) => lot.remaining > 0).map((lot) => lot.bayiId),
						),
					].map((bayiId) => {
						const rows = lots.filter(
							(lot) => lot.bayiId === bayiId && lot.remaining > 0,
						);
						return {
							bayiId: bayiId || null,
							bayiName: rows[0].bayiName,
							currentBayiName: rows[0].currentBayiName ?? null,
							quantity: Number(
								rows.reduce((sum, lot) => sum + lot.remaining, 0).toFixed(6),
							),
						};
					}),
					type: first.type,
					memoryGb: first.memoryGb,
					quantityUnit: first.quantityUnit,
					quantity: Number(
						lots.reduce((sum, lot) => sum + lot.remaining, 0).toFixed(6),
					),
					averagePurchaseCost:
						pool.quantity > 0 ? pool.value / pool.quantity : null,
					averageSellingPrice:
						soldQuantity > 0
							? productSales.reduce((sum, sale) => sum + sale.revenue, 0) /
								soldQuantity
							: null,
					listPurchasePrices: listPurchasePrices.filter(
						(price) => price.key === key,
					),
				};
			},
		);
		const lotsById = new Map(state.lots.map((lot) => [lot.lotId, lot]));
		const movements = [
			...(['all', 'purchase'].includes(selection.movementType)
				? filtered.map((lot) => ({
						id: lot.lotId,
						operationId: lot.orderId,
						kind: 'purchase',
						createdAt: lot.createdAt,
						bayiName: lot.bayiName,
						bayiId: lot.bayiId || null,
						currentBayiName: lot.currentBayiName ?? null,
						type: lot.type,
						memoryGb: lot.memoryGb,
						quantityUnit: lot.quantityUnit,
						quantity: lot.quantity,
						purchaseCost: lot.total,
						revenue: null,
						profit: null,
						orderId: lot.orderId,
					}))
				: []),
			...operations.flatMap((operation) =>
				operation.lines.map((line, index) => ({
					id: `${operation.requestId}:${index}`,
					operationId: operation.requestId,
					suppliers: (line.suppliers ?? []).map((part) => ({
						...part,
						currentBayiName: state.parties.bayi.currentName(part.bayiId),
						sourcePurchases: line.allocations.flatMap((allocation) => {
							const lot = lotsById.get(allocation.lotId);
							return lot && (lot.bayiId || null) === (part.bayiId || null)
								? [
										{
											orderId: lot.orderId,
											lotId: lot.lotId,
											quantity: allocation.quantity,
										},
									]
								: [];
						}),
					})),
					kind: operation.mode,
					createdAt: operation.createdAt,
					bayiName: null,
					type: line.type,
					memoryGb: line.memoryGb ?? null,
					quantityUnit: line.quantityUnit,
					quantity: line.quantity,
					purchaseCost: line.costOfGoods,
					revenue: line.revenue,
					profit: line.revenue - line.costOfGoods,
					orderId: null,
				})),
			),
		].sort(
			(a, b) =>
				b.createdAt.getTime() - a.createdAt.getTime() ||
				a.id.localeCompare(b.id),
		);
		const productKeys = new Set([
			...(['all', 'purchase'].includes(selection.movementType)
				? filtered.map(stockProductKey)
				: []),
			...sales.map(stockProductKey),
		]);
		const productSummary = [...productKeys].map((key) => {
			const purchaseLots = filtered.filter(
				(lot) => stockProductKey(lot) === key,
			);
			const productSales = sales.filter(
				(sale) => stockProductKey(sale) === key,
			);
			const first = purchaseLots[0] ?? productSales[0];
			const purchasedQuantity = purchaseLots.reduce(
					(sum, lot) => sum + lot.quantity,
					0,
				),
				actualPurchaseCost = purchaseLots.reduce(
					(sum, lot) => sum + lot.total,
					0,
				);
			const soldQuantity = productSales.reduce(
					(sum, line) => sum + line.quantity,
					0,
				),
				revenue = productSales.reduce((sum, line) => sum + line.revenue, 0),
				costOfGoods = productSales.reduce(
					(sum, line) => sum + line.costOfGoods,
					0,
				);
			return {
				key,
				type: first.type,
				memoryGb: first.memoryGb ?? null,
				quantityUnit: first.quantityUnit,
				purchaseQuantity: ['all', 'purchase'].includes(selection.movementType)
					? purchasedQuantity
					: 0,
				purchaseTotal: ['all', 'purchase'].includes(selection.movementType)
					? actualPurchaseCost
					: 0,
				soldQuantity,
				revenue,
				costOfGoods,
				profit: revenue - costOfGoods,
				currentQuantity: Number(
					state.lots
						.filter(
							(lot) =>
								stockProductKey(lot) === key &&
								(!bayiIds.length || bayiIds.includes(lot.bayiId)),
						)
						.reduce((sum, lot) => sum + lot.remaining, 0)
						.toFixed(6),
				),
				averagePurchasePrice:
					purchasedQuantity > 0 ? actualPurchaseCost / purchasedQuantity : null,
				averageSellingPrice: soldQuantity > 0 ? revenue / soldQuantity : null,
				margin: revenue > 0 ? ((revenue - costOfGoods) / revenue) * 100 : null,
			};
		});
		res.json({
			matchingSaleIds,
			selectedSaleCount: operations.length,
			productSummary,
			reportGeneratedAt: new Date().toISOString(),
			reportSales: operations.map((operation) => ({
				requestId: operation.requestId,
				createdAt: operation.createdAt,
				lines: operation.lines.map(
					({ allocations: _allocations, ...line }) => line,
				),
			})),
			positions,
			...stockActivityReport(movements, query.page, query.pageSize),
			profitsByBayi: summarizeSupplierSales(sales).map((row) => ({
				...row,
				currentBayiName: state.parties.bayi.currentName(row.bayiId),
			})),
			bayiFilterName: bayiIds.length
				? bayiIds
						.map((id) => state.parties.bayi.currentName(id) ?? id)
						.join(', ')
				: (query.bayiName ?? null),
			lots: filtered.slice(
				(query.page - 1) * query.pageSize,
				query.page * query.pageSize,
			),
			lotCount: filtered.length,
			page: query.page,
			totalPages: Math.max(1, Math.ceil(filtered.length / query.pageSize)),
			operations: [...operations]
				.reverse()
				.slice(0, 100)
				.map((operation) => ({
					...operation,
					lines: operation.lines.map(
						({ allocations: _allocations, ...line }) => line,
					),
				})),
			profits: summarizeStockSales(sales),
			profitsByMemory: summarizeStockSales(sales, true),
			movements: movements.slice(
				(query.page - 1) * query.pageSize,
				query.page * query.pageSize,
			),
			movementCount: movements.length,
			movementPages: Math.max(1, Math.ceil(movements.length / query.pageSize)),
			reportTotals: {
				costOfGoods: sales.reduce((sum, row) => sum + row.costOfGoods, 0),
				purchaseCost: movements
					.filter((row) => row.kind === 'purchase')
					.reduce((sum, row) => sum + row.purchaseCost, 0),
				revenue: sales.reduce((sum, row) => sum + row.revenue, 0),
				profit: sales.reduce(
					(sum, row) => sum + row.revenue - row.costOfGoods,
					0,
				),
			},
		});
	} catch (error) {
		handleHttpError(error, res, logger);
	}
};
export const postSale = async (req: Request, res: Response) => {
	try {
		const actor = await logActor(req);
		const { operation, isNew } = await recordStockSale(
			stockSaleSchema.parse(req.body),
			actor.adminId,
		);
		if (isNew)
			await recordLogEvent({
				...actor,
				action:
					operation.mode === 'complete'
						? LOG_ACTIONS.STOCK_RESTOCK_COMPLETE
						: LOG_ACTIONS.STOCK_RESTOCK_PARTIAL,
				entityType: LOG_ENTITY_TYPES.STOCK_RESTOCK,
				bayis: [
					...new Map(
						operation.lines.flatMap((line) =>
							(line.suppliers ?? []).map(
								(part) =>
									[
										part.bayiId ?? 'unlinked:' + part.bayiName,
										{ bayiId: part.bayiId, bayiName: part.bayiName },
									] as const,
							),
						),
					).values(),
				],
				entityId: null,
				entityKey: `${operation.mode === 'complete' ? 'Tüm stok satışı' : 'Kısmi satış'} · ${operation.lines.map(productLabel).join(', ')}`,
				fields: [
					{
						field: 'operationId',
						previousValue: null,
						newValue: operation.requestId,
					},
					...operation.lines.map((line) => ({
						field: productLabel(line),
						previousValue: line.previousQuantity ?? null,
						newValue: line.remainingQuantity ?? null,
					})),
					...operation.lines.flatMap((line) =>
						(line.suppliers ?? []).flatMap((part) => [
							{
								field:
									part.bayiName +
									' · ' +
									productLabel(line) +
									' · Satılan miktar',
								previousValue: null,
								newValue: part.quantity,
							},
							{
								field:
									part.bayiName + ' · ' + productLabel(line) + ' · Kâr (TL)',
								previousValue: null,
								newValue: part.revenue - part.costOfGoods,
							},
						]),
					),
					...operation.lines.map((line) => ({
						field: `${productLabel(line)} · Satış geliri (TL)`,
						previousValue: null,
						newValue: line.revenue,
					})),
					{
						field: 'totalRevenue',
						previousValue: null,
						newValue: operation.totalRevenue,
					},
					{
						field: 'costOfGoods',
						previousValue: null,
						newValue: operation.totalCostOfGoods,
					},
				],
			});
		res.status(201).json({ operation });
	} catch (error) {
		handleHttpError(error, res, logger);
	}
};
export const postPurchaseWarnings = async (req: Request, res: Response) => {
	try {
		const input = purchaseWarningSchema.parse(req.body);
		res.json(
			await inspectPurchaseWarnings(
				input.bayiId,
				input.lines,
				input.comparisonDays,
			),
		);
	} catch (error) {
		handleHttpError(error, res, logger);
	}
};
