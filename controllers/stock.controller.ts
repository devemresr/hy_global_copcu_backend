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
import { summarizeStockSales } from '../services/stockReport.service';
import { z } from 'zod';

const reportFilters = z.object({
	movementType: z
		.enum(['all', 'purchase', 'restock', 'complete', 'partial'])
		.default('all'),
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
		const [state, listPurchasePrices] = await Promise.all([
			loadStock(),
			loadPurchasePrices(),
		]);
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
				(!query.bayiName ||
					lot.bayiName
						.toLocaleLowerCase('tr')
						.includes(query.bayiName.toLocaleLowerCase('tr'))) &&
				inRange(lot.createdAt, lot.orderTotal),
		);
		const positions = [...new Set(state.lots.map(stockProductKey))].map(
			(key) => {
				const lots = state.lots.filter((lot) => stockProductKey(lot) === key);
				const first = lots[0];
				const pool = state.pools.get(key)!;
				const sales = state.book.sales.filter(
					(sale) => stockProductKey(sale) === key,
				);
				const soldQuantity = sales.reduce(
					(sum, sale) => sum + sale.quantity,
					0,
				);
				return {
					key,
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
							? sales.reduce((sum, sale) => sum + sale.revenue, 0) /
								soldQuantity
							: null,
					listPurchasePrices: listPurchasePrices.filter(
						(price) => price.key === key,
					),
				};
			},
		);
		const operations = state.book.operations
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
				lines: operation.lines.filter(matchesProduct),
			}))
			.filter((operation) => operation.lines.length > 0);
		const sales = operations.flatMap((operation) =>
			operation.lines.map((line) => ({
				...line,
				createdAt: operation.createdAt,
			})),
		);
		const movements = [
			...(['all', 'purchase'].includes(selection.movementType)
				? filtered.map((lot) => ({
						id: lot.lotId,
						kind: 'purchase',
						createdAt: lot.createdAt,
						bayiName: lot.bayiName,
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
					kind: operation.mode,
					createdAt: operation.createdAt,
					bayiName: null,
					type: line.type,
					memoryGb: line.memoryGb,
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
		res.json({
			positions,
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
				entityId: null,
				entityKey: `${operation.mode === 'complete' ? 'Tam yenileme' : 'Kısmi yenileme'} · ${operation.lines.map(productLabel).join(', ')}`,
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
		res.json(await inspectPurchaseWarnings(input.bayiId, input.lines));
	} catch (error) {
		handleHttpError(error, res, logger);
	}
};
