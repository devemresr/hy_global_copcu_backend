import { loadPartyDirectory } from '../services/partyIdentity.service';
import {
	orderNumericExpression,
	numericFieldsFor,
} from '../schemas/numericFilters.schema';
import type { Request, Response } from 'express';
import { Types, type QueryFilter } from 'mongoose';
import { requireUserId } from './auth.helper';
import { createOrderSchema, orderQuerySchema } from '../schemas/order.schema';
import { loadOrderPurchasePricing } from '../services/purchasePrices.service';
import {
	ORDER_MEMORY_SIZES,
	ORDER_PRODUCT_TYPES,
} from '../constants/orderProducts.constant';
import { Order } from '../models/Order';
import { Bayi } from '../models/Bayi';
import { ValidationError, UnauthorizedError } from '../errors/HttpError';
import { handleHttpError } from '../errors/handleHttpError';
import logger from '../util/logger';
import {
	checkPurchaseWarnings,
	withStockWrite,
} from '../services/stock.service';
import { User } from '../models/User';
import { LOG_ACTIONS, LOG_ENTITY_TYPES } from '../models/LogEvent';
import { recordLogEvent } from '../services/logEvents/recordLogEvent.service';

export const getOrderPricing = async (
	_req: Request,
	res: Response,
): Promise<void> => {
	try {
		res.json({
			...(await loadOrderPurchasePricing()),
			productTypes: ORDER_PRODUCT_TYPES,
			memorySizes: ORDER_MEMORY_SIZES,
		});
	} catch (error) {
		handleHttpError(error, res, logger);
	}
};

export const createOrder = async (
	req: Request,
	res: Response,
): Promise<void> => {
	try {
		const input = createOrderSchema.parse(req.body);
		const adminId = requireUserId(req);
		const actor = await User.findById(adminId).select('username').lean();
		if (!actor) throw new UnauthorizedError();
		const bayi = await Bayi.findById(input.bayiId).select('name phone').lean();
		if (!bayi)
			throw new ValidationError(
				'Seçilen bayi bulunamadı. Bayi listesini yenileyip tekrar seçin.',
			);
		const prices = await loadOrderPurchasePricing();
		const lines = input.lines.map((line) => {
			const requiresMemorySize =
				ORDER_PRODUCT_TYPES[line.type].requiresMemorySize;
			const memoryGb = requiresMemorySize ? line.memoryGb! : null;
			const catalogPrice =
				memoryGb !== null
					? prices.unitPrices[line.type]?.[memoryGb]?.[line.quantityUnit]
					: undefined;
			const originalUnitPrice = catalogPrice ?? line.manualListPrice ?? null;
			const unitPrice =
				line.totalPriceOverride === undefined
					? (line.unitPriceOverride ?? originalUnitPrice)
					: line.totalPriceOverride / line.quantity;
			if (unitPrice !== null && unitPrice > 1_000_000)
				throw new ValidationError('Birim fiyat 1.000.000 TL değerini aşamaz.');
			if (unitPrice === null)
				throw new ValidationError(
					`${ORDER_PRODUCT_TYPES[line.type].label}${memoryGb === null ? '' : ` / ${memoryGb} GB`}: ${line.quantityUnit === 'piece' ? 'adet' : line.quantityUnit} birim fiyatını girin.`,
				);
			return {
				type: line.type,
				memoryGb,
				requiresMemorySize,
				quantityUnit: line.quantityUnit,
				quantity: line.quantity,
				originalUnitPrice,
				unitPrice,
				priceAdjustment:
					originalUnitPrice === null
						? null
						: Math.round((unitPrice - originalUnitPrice) * 100) / 100,
				total:
					line.totalPriceOverride ??
					Math.round(unitPrice * line.quantity * 100) / 100,
			};
		});
		const unitTotals = { piece: 0, kg: 0, g: 0 };
		for (const line of lines)
			unitTotals[line.quantityUnit] =
				Math.round((unitTotals[line.quantityUnit] + line.quantity) * 1000) /
				1000;
		const order = new Order({
			name: bayi.name,
			bayiId: bayi._id,
			bayiPhone: bayi.phone,
			lines,
			unitTotals,
			total: Math.round(lines.reduce((s, l) => s + l.total, 0) * 100) / 100,
			quantity: unitTotals.piece,
			createdBy: requireUserId(req),
		});
		const warnings = await withStockWrite(async () => {
			const claims = await checkPurchaseWarnings(
				input.bayiId,
				lines,
				input.comparisonDays,
			);
			await order.save();
			return claims;
		});
		await recordLogEvent({
			adminId,
			adminUsername: actor.username,
			action: LOG_ACTIONS.STOCK_PURCHASE_CREATE,
			entityType: LOG_ENTITY_TYPES.STOCK_PURCHASE,
			entityId: String(order._id),
			bayiId: String(bayi._id),
			bayiName: bayi.name,
			entityKey: `${bayi.name} · ${lines.map((line) => `${ORDER_PRODUCT_TYPES[line.type].label}${line.memoryGb === null ? '' : ` ${line.memoryGb} GB`}`).join(', ')}`,
			fields: [
				{ field: 'bayiName', previousValue: null, newValue: bayi.name },
				...lines.flatMap((line) => {
					const label = `${ORDER_PRODUCT_TYPES[line.type].label}${line.memoryGb === null ? '' : ` ${line.memoryGb} GB`}`;
					const unit =
						line.quantityUnit === 'piece' ? 'adet' : line.quantityUnit;
					return [
						{
							field: `${label} · Giriş miktarı (${unit})`,
							previousValue: null,
							newValue: line.quantity,
						},
						{
							field: `${label} · Birim alış fiyatı (TL/${unit})`,
							previousValue: null,
							newValue: line.unitPrice,
						},
					];
				}),
				{
					field: 'totalPurchaseCost',
					previousValue: null,
					newValue: order.total,
				},
			],
		});
		// Saving this purchase advances this supplier's warning cycle in MongoDB.
		// No reset is attempted on a failed mutation, and no toast state is involved.
		res.status(201).json({ order, warnings });
	} catch (error) {
		handleHttpError(error, res, logger);
	}
};

export const listOrders = async (
	req: Request,
	res: Response,
): Promise<void> => {
	try {
		const parsed = orderQuerySchema.safeParse(
			req.method === 'POST' ? req.body : req.query,
		);
		if (!parsed.success)
			throw new ValidationError(
				parsed.error.issues.map((i) => i.message).join(' '),
			);
		const q = parsed.data;
		const parties = await loadPartyDirectory();
		const filter: QueryFilter<typeof Order.schema> = {};
		const bayiIds = q.bayiIds?.length ? q.bayiIds : q.bayiId ? [q.bayiId] : [];
		if (bayiIds.length) {
			const ids = new Set(bayiIds);
			const legacy = [...parties.purchases]
				.filter(([, party]) => party.bayiId && ids.has(party.bayiId))
				.map(([id]) => new Types.ObjectId(id));
			filter.$or = [
				{ bayiId: { $in: bayiIds.map((id) => new Types.ObjectId(id)) } },
				{ _id: { $in: legacy } },
			];
		}
		if (!bayiIds.length && q.bayiName)
			filter.name = {
				$regex: q.bayiName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
				$options: 'i',
			};
		if (q.purchaseId) filter._id = new Types.ObjectId(q.purchaseId);
		if (q.excludeIds?.length)
			filter._id = {
				...(q.purchaseId ? { $eq: new Types.ObjectId(q.purchaseId) } : {}),
				$nin: q.excludeIds.map((id) => new Types.ObjectId(id)),
			};
		if (q.from || q.until) {
			filter.createdAt = {
				...(q.from ? { $gte: new Date(`${q.from}T00:00:00+03:00`) } : {}),
				...(q.until
					? {
							$lt: new Date(
								new Date(`${q.until}T00:00:00+03:00`).getTime() + 86400000,
							),
						}
					: {}),
			};
		}
		if (q.minTotal !== undefined || q.maxTotal !== undefined)
			filter.total = {
				...(q.minTotal !== undefined ? { $gte: q.minTotal } : {}),
				...(q.maxTotal !== undefined ? { $lte: q.maxTotal } : {}),
			};
		if (
			q.numericFilters?.some(
				(f) => !numericFieldsFor('orders').includes(f.field),
			)
		)
			throw new ValidationError('Bu rapor için geçersiz sayı alanı.');
		if (q.numericFilters?.length)
			filter.$expr = orderNumericExpression(q.numericFilters);
		const memoryTypes = Object.entries(ORDER_PRODUCT_TYPES)
			.filter(([, product]) => product.requiresMemorySize)
			.map(([type]) => type);
		const requiresMemory = {
			$ifNull: [
				'$$line.requiresMemorySize',
				{ $in: ['$$line.type', memoryTypes] },
			],
		};
		const unit = { $ifNull: ['$lines.quantityUnit', 'piece'] };
		const sumUnit = (quantityUnit: string) => ({
			$sum: { $cond: [{ $eq: [unit, quantityUnit] }, '$lines.quantity', 0] },
		});
		const [result] = await Order.aggregate([
			{ $match: filter },
			{
				$set: {
					lines: {
						$map: {
							input: '$lines',
							as: 'line',
							in: {
								$mergeObjects: [
									'$$line',
									{
										quantityUnit: { $ifNull: ['$$line.quantityUnit', 'piece'] },
										requiresMemorySize: requiresMemory,
										memoryGb: {
											$cond: [
												requiresMemory,
												{ $ifNull: ['$$line.memoryGb', null] },
												null,
											],
										},
									},
								],
							},
						},
					},
					unitTotals: {
						$ifNull: ['$unitTotals', { piece: '$quantity', kg: 0, g: 0 }],
					},
				},
			},
			{
				$facet: {
					timeline: [
						{ $sort: { createdAt: 1, _id: 1 } },
						{
							$project: {
								_id: 1,
								name: { $ifNull: ['$name', { $toString: '$_id' }] },
								createdAt: 1,
								total: 1,
								quantity: 1,
								unitTotals: 1,
							},
						},
					],
					orders: [
						{ $sort: { createdAt: -1, _id: -1 } },
						{ $skip: (q.page - 1) * q.pageSize },
						{ $limit: q.pageSize },
						{ $unset: 'lines.listPriceSource' },
						{ $set: { name: { $ifNull: ['$name', { $toString: '$_id' }] } } },
					],
					summary: [
						{
							$group: {
								_id: null,
								count: { $sum: 1 },
								total: { $sum: '$total' },
								quantity: { $sum: '$quantity' },
								piece: { $sum: '$unitTotals.piece' },
								kg: { $sum: '$unitTotals.kg' },
								g: { $sum: '$unitTotals.g' },
							},
						},
						{
							$project: {
								count: 1,
								total: 1,
								quantity: 1,
								unitTotals: {
									piece: '$piece',
									kg: { $round: ['$kg', 3] },
									g: { $round: ['$g', 3] },
								},
							},
						},
					],
					daily: [
						{
							$group: {
								_id: {
									$dateToString: {
										date: '$createdAt',
										format: '%Y-%m-%d',
										timezone: 'Europe/Istanbul',
									},
								},
								total: { $sum: '$total' },
								count: { $sum: 1 },
							},
						},
						{ $sort: { _id: 1 } },
					],
					byType: [
						{ $unwind: '$lines' },
						{
							$group: {
								_id: '$lines.type',
								total: { $sum: '$lines.total' },
								quantity: sumUnit('piece'),
								kg: sumUnit('kg'),
								g: sumUnit('g'),
							},
						},
						{
							$project: {
								total: 1,
								quantity: 1,
								unitTotals: {
									piece: '$quantity',
									kg: { $round: ['$kg', 3] },
									g: { $round: ['$g', 3] },
								},
							},
						},
						{ $sort: { total: -1, _id: 1 } },
					],
					byMemory: [
						{ $unwind: '$lines' },
						{
							$match: {
								'lines.requiresMemorySize': true,
								'lines.quantityUnit': 'piece',
								'lines.memoryGb': { $type: 'number' },
							},
						},
						{
							$group: {
								_id: '$lines.memoryGb',
								total: { $sum: '$lines.total' },
								quantity: { $sum: '$lines.quantity' },
							},
						},
						{ $sort: { _id: 1 } },
					],
					byTypeAndMemory: [
						{ $unwind: '$lines' },
						{
							$group: {
								_id: {
									type: '$lines.type',
									memoryGb: '$lines.memoryGb',
									quantityUnit: '$lines.quantityUnit',
									requiresMemorySize: '$lines.requiresMemorySize',
								},
								total: { $sum: '$lines.total' },
								quantity: { $sum: '$lines.quantity' },
							},
						},
						{
							$project: {
								_id: 0,
								type: '$_id.type',
								memoryGb: '$_id.memoryGb',
								quantityUnit: '$_id.quantityUnit',
								requiresMemorySize: '$_id.requiresMemorySize',
								quantity: { $round: ['$quantity', 3] },
								total: 1,
							},
						},
						{ $sort: { type: 1, memoryGb: 1, quantityUnit: 1 } },
					],
					missingListPrices: [
						{ $unwind: '$lines' },
						{ $match: { 'lines.originalUnitPrice': null } },
						{
							$project: {
								_id: 0,
								orderId: { $toString: '$_id' },
								orderName: { $ifNull: ['$name', { $toString: '$_id' }] },
								createdAt: 1,
								type: '$lines.type',
								memoryGb: '$lines.memoryGb',
								quantityUnit: '$lines.quantityUnit',
								requiresMemorySize: '$lines.requiresMemorySize',
								quantity: '$lines.quantity',
								unitPrice: '$lines.unitPrice',
								total: '$lines.total',
							},
						},
						{ $sort: { createdAt: -1, orderId: 1 } },
					],
					adjustments: [
						{ $unwind: '$lines' },
						{
							$match: {
								'lines.originalUnitPrice': { $type: 'number' },
								$expr: {
									$ne: ['$lines.unitPrice', '$lines.originalUnitPrice'],
								},
							},
						},
						{
							$project: {
								_id: 0,
								orderId: { $toString: '$_id' },
								orderName: { $ifNull: ['$name', { $toString: '$_id' }] },
								createdAt: 1,
								type: '$lines.type',
								memoryGb: '$lines.memoryGb',
								quantityUnit: '$lines.quantityUnit',
								requiresMemorySize: '$lines.requiresMemorySize',
								quantity: '$lines.quantity',
								originalUnitPrice: '$lines.originalUnitPrice',
								unitPrice: '$lines.unitPrice',
								priceAdjustment: '$lines.priceAdjustment',
								totalAdjustment: {
									$round: [
										{
											$multiply: ['$lines.priceAdjustment', '$lines.quantity'],
										},
										2,
									],
								},
							},
						},
						{ $sort: { createdAt: -1, orderId: 1 } },
					],
				},
			},
		]);
		const summary = result.summary[0] ?? { count: 0, total: 0, quantity: 0 };
		res.json({
			bayiFilterName: bayiIds.length
				? bayiIds.map((id) => parties.bayi.currentName(id) ?? id).join(', ')
				: (q.bayiName ?? null),
			orders: result.orders.map((row: { _id: unknown }) => ({
				...row,
				...parties.purchases.get(String(row._id)),
			})),
			timeline: result.timeline.map((row: { _id: unknown }) => ({
				...row,
				...parties.purchases.get(String(row._id)),
			})),
			summary,
			daily: result.daily,
			byType: result.byType,
			byMemory: result.byMemory,
			byTypeAndMemory: result.byTypeAndMemory,
			adjustments: result.adjustments,
			missingListPrices: result.missingListPrices,
			page: q.page,
			totalPages: Math.max(1, Math.ceil(summary.count / q.pageSize)),
		});
	} catch (error) {
		handleHttpError(error, res, logger);
	}
};
