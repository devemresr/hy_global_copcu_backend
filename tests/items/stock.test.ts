import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import app from '../../app';
import { Bayi } from '../../models/Bayi';
import { PurchaseWarning } from '../../models/PurchaseWarning';
import { StockSale } from '../../models/StockSale';
import { StockRestock } from '../../models/StockRestock';
import { LogEvent } from '../../models/LogEvent';
import { Order } from '../../models/Order';
import { Item } from '../../models/Item';
import {
	STOCK_ROUTES,
	ORDER_ROUTES,
	LOG_EVENTS_ROUTES,
} from '../../routes/routes.constant';
import { loginAndGetTokens } from '../helpers';

const a = '000000000000000000000031';
const b = '000000000000000000000032';
const product: { type: string; memoryGb: number | null; quantityUnit: string } =
	{ type: 'EMMC', memoryGb: 64, quantityUnit: 'piece' };
let auth: string;
beforeEach(async () => {
	await Bayi.create([
		{ _id: a, name: 'Store A', nameKey: 'store a', phone: '+905551110001' },
		{ _id: b, name: 'Store B', nameKey: 'store b', phone: '+905551110002' },
	]);
	auth = `Bearer ${(await loginAndGetTokens()).accessToken}`;
});
async function purchase(
	bayiId: string,
	quantity: number,
	price: number,
	variant = product,
) {
	const result = await request(app)
		.post(ORDER_ROUTES.CREATE)
		.set('Authorization', auth)
		.send({
			bayiId,
			lines: [{ ...variant, quantity, unitPriceOverride: price }],
		});
	expect(result.status).toBe(201);
	return result.body.order;
}
const stock = (query = {}) =>
	request(app).get(STOCK_ROUTES.LIST).set('Authorization', auth).query(query);
const sell = (body: Record<string, unknown>) => {
	const { requestId = randomUUID(), mode = 'complete', ...line } = body;
	return request(app)
		.post(STOCK_ROUTES.SALES)
		.set('Authorization', auth)
		.send({
			requestId,
			mode,
			lines: [{ ...product, quantity: 40, revenue: 16000, ...line }],
		});
};
const warning = (bayiId = b, unitPrice = 450, variant = product) =>
	request(app)
		.post(STOCK_ROUTES.WARNINGS)
		.set('Authorization', auth)
		.send({ bayiId, lines: [{ ...variant, unitPrice }] });

describe('stock management', () => {
	it.each([undefined, null, ''])(
		'filters dealer names safely when a legacy purchase name is %s',
		async (name) => {
			const legacy = await purchase(a, 5, 300);
			await Order.findByIdAndUpdate(
				legacy._id,
				name === undefined ? { $unset: { name: 1 } } : { $set: { name } },
			);
			await purchase(b, 2, 200);

			const all = await stock();
			expect(all.status).toBe(200);
			expect(all.body.lotCount).toBe(2);
			expect(
				all.body.lots.find(
					(lot: { orderId: string }) => lot.orderId === legacy._id,
				).bayiName,
			).toBe('');
			expect(all.body.positions[0].quantity).toBe(7);

			const filtered = await stock({
				bayiName: 'store b',
				movementType: 'purchase',
			});
			expect(filtered.status).toBe(200);
			expect(filtered.body.lotCount).toBe(1);
			expect(filtered.body.movements).toEqual([
				expect.objectContaining({ bayiName: 'Store B', quantity: 2 }),
			]);
			expect(filtered.body.reportTotals.purchaseCost).toBe(400);
			expect(filtered.body.positions[0].quantity).toBe(7);
		},
	);
	it('reads catalog purchase prices per currency and excludes deleted models', async () => {
		await Item.insertMany([
			{
				model: 'A',
				bellekTipi: 'eMMC',
				depolama: 64,
				fiyat: 300,
				paraBirimi: 'TRY',
			},
			{
				model: 'B',
				bellekTipi: 'EMMC',
				depolama: 64,
				fiyat: 300,
				paraBirimi: 'TRY',
			},
			{
				model: 'Exception',
				bellekTipi: 'EMMC',
				depolama: 64,
				fiyat: 350,
				paraBirimi: 'TRY',
			},
			{
				model: 'USD',
				bellekTipi: 'EMMC',
				depolama: 64,
				fiyat: 10,
				paraBirimi: 'USD',
			},
			{
				model: 'Deleted',
				bellekTipi: 'EMMC',
				depolama: 64,
				fiyat: 1,
				paraBirimi: 'TRY',
				deletedAt: new Date(),
			},
		]);
		await purchase(a, 2, 250);
		const report = await stock();
		expect(report.body.positions[0].listPurchasePrices).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					currency: 'TRY',
					unitPrice: 300,
					hasExceptions: true,
				}),
				expect.objectContaining({ currency: 'USD', unitPrice: 10 }),
			]),
		);
		const pricing = await request(app)
			.get(ORDER_ROUTES.PRICING)
			.set('Authorization', auth);
		expect(pricing.body.prices.EMMC['64']).toBe(300);
		await Item.updateMany(
			{ paraBirimi: 'TRY', deletedAt: null },
			{ $set: { fiyat: 375 } },
		);
		expect((await stock()).body.positions[0].listPurchasePrices).toContainEqual(
			expect.objectContaining({
				currency: 'TRY',
				unitPrice: 375,
				hasExceptions: false,
			}),
		);
	});
	it('separates sizes, combines memory types by capacity, and filters unified movements before pagination', async () => {
		await purchase(a, 4, 10, {
			type: 'EMMC',
			memoryGb: 8,
			quantityUnit: 'piece',
		});
		await purchase(b, 2, 100, {
			type: 'EMMC',
			memoryGb: 16,
			quantityUnit: 'piece',
		});
		await purchase(a, 2, 30, {
			type: 'EMCP',
			memoryGb: 8,
			quantityUnit: 'piece',
		});
		const restock = await request(app)
			.post(STOCK_ROUTES.SALES)
			.set('Authorization', auth)
			.send({
				requestId: randomUUID(),
				mode: 'partial',
				lines: [
					{
						type: 'EMMC',
						memoryGb: 8,
						quantityUnit: 'piece',
						quantity: 2,
						revenue: 60,
					},
					{
						type: 'EMMC',
						memoryGb: 16,
						quantityUnit: 'piece',
						quantity: 1,
						revenue: 150,
					},
					{
						type: 'EMCP',
						memoryGb: 8,
						quantityUnit: 'piece',
						quantity: 1,
						revenue: 50,
					},
				],
			});
		expect(restock.status).toBe(201);
		const report = (await stock()).body;
		expect(report.profits).toHaveLength(3);
		expect(report.profits).toContainEqual(
			expect.objectContaining({
				type: 'EMMC',
				memoryGb: 8,
				averagePurchaseCost: 10,
				averageSellingPrice: 30,
				profit: 40,
			}),
		);
		expect(report.profitsByMemory).toContainEqual(
			expect.objectContaining({
				type: null,
				memoryGb: 8,
				quantity: 3,
				revenue: 110,
				costOfGoods: 50,
				profit: 60,
			}),
		);
		expect(
			report.positions.find((p: { key: string }) => p.key === 'EMMC:8:piece'),
		).toMatchObject({ averagePurchaseCost: 10, averageSellingPrice: 30 });
		const filtered = (
			await stock({ movementType: 'restock', memoryGb: 8, pageSize: 1 })
		).body;
		expect(filtered.movementCount).toBe(2);
		expect(filtered.movements).toHaveLength(1);
		expect(filtered.movementPages).toBe(2);
		expect(filtered.reportTotals).toMatchObject({
			purchaseCost: 0,
			revenue: 110,
			profit: 60,
		});
		expect(
			(await stock({ movementType: 'purchase', bayiName: 'Store B' })).body
				.movements,
		).toEqual([
			expect.objectContaining({
				kind: 'purchase',
				bayiName: 'Store B',
				memoryGb: 16,
			}),
		]);
		expect((await stock({ productType: 'bad' })).status).toBe(400);
	});
	it('logs stock purchases separately from restock operations', async () => {
		const order = await purchase(a, 5, 300);
		const events = await LogEvent.find({ entityType: 'stock_purchase' }).lean();
		expect(events).toHaveLength(1);
		expect(events[0].entityId?.toString()).toBe(order._id);
		expect(events[0].adminUsername).toBe('admin');
		expect(
			events[0].fields.find((field) => field.field === 'totalPurchaseCost')
				?.newValue,
		).toBe(1500);
	});
	it('reports missing selling prices and keeps existing risks visible without repeating toasts', async () => {
		const missing = await warning();
		expect(missing.body.missingPrices).toEqual(['eMMC 64 GB (adet)']);
		expect(missing.body.warnings).toHaveLength(0);
		await purchase(a, 1, 300);
		expect((await sell({ quantity: 1, revenue: 400 })).status).toBe(201);
		const first = await warning();
		expect(first.body.warnings).toHaveLength(1);
		expect(first.body.risks[0].alreadyWarned).toBe(false);
		const repeated = await warning();
		expect(repeated.body.warnings).toHaveLength(0);
		expect(repeated.body.risks[0].alreadyWarned).toBe(true);
		expect((await warning(b, 300)).body.risks).toHaveLength(0);
	});
	it.each(['complete', 'partial'])(
		'saves multiple products as one %s operation and one audit event',
		async (mode) => {
			await purchase(a, 5, 300);
			await purchase(b, 3, 50, {
				type: 'EMCP',
				memoryGb: 8,
				quantityUnit: 'piece',
			});
			const requestId = randomUUID();
			const payload = {
				requestId,
				mode,
				lines: [
					{ ...product, quantity: mode === 'complete' ? 5 : 2, revenue: 2000 },
					{
						type: 'EMCP',
						memoryGb: 8,
						quantityUnit: 'piece',
						quantity: mode === 'complete' ? 3 : 1,
						revenue: 300,
					},
				],
			};
			const submit = () =>
				request(app)
					.post(STOCK_ROUTES.SALES)
					.set('Authorization', auth)
					.send(payload);
			const result = await submit();
			expect(result.status).toBe(201);
			expect(result.body.operation.lines).toHaveLength(2);
			expect(result.body.operation.totalRevenue).toBe(2300);
			const report = await stock();
			expect(report.body.operations).toHaveLength(1);
			expect(report.body.operations[0].lines).toHaveLength(2);
			expect(
				report.body.positions
					.map((p: { quantity: number }) => p.quantity)
					.sort(),
			).toEqual(mode === 'complete' ? [0, 0] : [2, 3]);
			expect((await submit()).status).toBe(201);
			expect(await StockRestock.countDocuments()).toBe(1);
			const events = await LogEvent.find({
				entityType: 'stock_restock',
			}).lean();
			expect(events).toHaveLength(1);
			expect(events[0].adminUsername).toBe('admin');
			expect(
				events[0].fields.find((field) => field.field === 'operationId')
					?.newValue,
			).toBe(requestId);
			expect(
				events[0].fields.some((field) => field.field.includes('eMCP')),
			).toBe(true);
			const history = await request(app)
				.get(LOG_EVENTS_ROUTES.LIST)
				.set('Authorization', auth)
				.query({ types: 'stock_restock' });
			expect(history.status).toBe(200);
			expect(history.body.total).toBe(1);
		},
	);
	it('rejects an entire multi-product operation if any row is invalid or duplicated', async () => {
		await purchase(a, 5, 300);
		await purchase(b, 3, 50, {
			type: 'EMCP',
			memoryGb: 8,
			quantityUnit: 'piece',
		});
		const first = { ...product, quantity: 2, revenue: 800 };
		for (const lines of [
			[
				first,
				{
					type: 'EMCP',
					memoryGb: 8,
					quantityUnit: 'piece',
					quantity: 4,
					revenue: 100,
				},
			],
			[first, first],
		]) {
			const result = await request(app)
				.post(STOCK_ROUTES.SALES)
				.set('Authorization', auth)
				.send({ requestId: randomUUID(), mode: 'partial', lines });
			expect(result.status).toBe(400);
		}
		expect(await StockRestock.countDocuments()).toBe(0);
		expect(await LogEvent.countDocuments({ entityType: 'stock_restock' })).toBe(
			0,
		);
		expect(
			(await stock()).body.positions.find(
				(p: { type: string }) => p.type === 'EMMC',
			).quantity,
		).toBe(5);
	});
	it('preserves legacy single-product stock history alongside new operations', async () => {
		const order = await purchase(a, 5, 300);
		await StockSale.create({
			_id: randomUUID(),
			requestId: randomUUID(),
			...product,
			quantityUnit: 'piece',
			mode: 'partial',
			quantity: 1,
			revenue: 400,
			costOfGoods: 300,
			averagePurchaseCost: 300,
			allocations: [{ lotId: `${order._id}:0`, quantity: 1 }],
			createdAt: new Date(),
			createdBy: order.createdBy,
		});
		const report = await stock();
		expect(report.body.positions[0].quantity).toBe(4);
		expect(report.body.operations[0].lines).toHaveLength(1);
		expect((await sell({ mode: 'partial', quantity: 1 })).status).toBe(201);
		expect((await stock()).body.positions[0].quantity).toBe(3);
	});
	it('uses quantity-weighted costs across suppliers and freezes realized cost snapshots', async () => {
		await purchase(a, 30, 300);
		await purchase(b, 10, 450);
		const before = await stock();
		expect(before.body.positions[0]).toMatchObject({
			quantity: 40,
			averagePurchaseCost: 337.5,
		});
		const sold = await sell({});
		expect(sold.status).toBe(201);
		expect(sold.body.operation.lines[0]).toMatchObject({
			averagePurchaseCost: 337.5,
			costOfGoods: 13500,
		});
		await purchase(a, 10, 100);
		const report = await stock();
		expect(report.body.positions[0]).toMatchObject({
			quantity: 10,
			averagePurchaseCost: 100,
		});
		expect(report.body.profits[0]).toMatchObject({
			averagePurchaseCost: 337.5,
			averageSellingPrice: 400,
			revenue: 16000,
			costOfGoods: 13500,
			profit: 2500,
			margin: 15.625,
		});
		expect(report.body.profits[0]).not.toHaveProperty('bayiId');
	});
	it('deducts partial quantities from product totals without supplier/order selection', async () => {
		await purchase(a, 30, 300);
		await purchase(b, 10, 450);
		const result = await sell({ mode: 'partial', quantity: 10, revenue: 4000 });
		expect(result.status).toBe(201);
		expect(result.body.operation.lines[0].costOfGoods).toBe(3375);
		const report = await stock({ bayiName: 'Store A', minTotal: 8000 });
		expect(report.body.lots).toHaveLength(1);
		expect(report.body.positions[0]).toMatchObject({
			quantity: 30,
			averagePurchaseCost: 337.5,
		});
		const all = await stock();
		expect(
			all.body.lots.reduce(
				(sum: number, lot: { remaining: number }) => sum + lot.remaining,
				0,
			),
		).toBe(30);
		expect(
			await LogEvent.countDocuments({ action: 'stock:restock_partial' }),
		).toBe(1);
	});
	it('rejects incomplete full restocks, incorrect allocations and overselling without changing stock', async () => {
		const order = await purchase(a, 5, 300);
		for (const body of [
			{ quantity: 4 },
			{ quantity: 6 },
			{
				mode: 'partial',
				quantity: 2,
				allocations: [{ lotId: `${order._id}:0`, quantity: 1 }],
			},
			{
				mode: 'partial',
				quantity: 2,
				allocations: [
					{ lotId: `${order._id}:0`, quantity: 1 },
					{ lotId: `${order._id}:0`, quantity: 1 },
				],
			},
		])
			expect((await sell(body)).status).toBe(400);
		expect((await stock()).body.positions[0].quantity).toBe(5);
	});
	it('atomically prevents concurrent overselling and treats retries as one sale', async () => {
		await purchase(a, 5, 300);
		const results = await Promise.all([
			sell({ quantity: 5 }),
			sell({ quantity: 5 }),
		]);
		expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
		const sale = results.find((r) => r.status === 201)!.body.operation;
		const retry = await sell({ quantity: 5, requestId: sale.requestId });
		expect(retry.status).toBe(201);
		expect(await StockRestock.countDocuments()).toBe(1);
	});
	it('normalizes grams and kg while keeping pieces separate and handles zero sales revenue', async () => {
		await purchase(a, 500, 0.4, {
			type: 'IPHONE',
			memoryGb: null,
			quantityUnit: 'g',
		});
		await purchase(b, 1.5, 300, {
			type: 'IPHONE',
			memoryGb: null,
			quantityUnit: 'kg',
		});
		await purchase(a, 2, 50, {
			type: 'IPHONE',
			memoryGb: null,
			quantityUnit: 'piece',
		});
		const result = await sell({
			type: 'IPHONE',
			memoryGb: null,
			quantityUnit: 'g',
			quantity: 2000,
			revenue: 0,
		});
		expect(result.status).toBe(201);
		expect(result.body.operation.lines[0].costOfGoods).toBe(650);
		const report = await stock();
		expect(report.body.profits[0]).toMatchObject({
			type: 'IPHONE',
			quantityUnit: 'kg',
			quantity: 2,
			revenue: 0,
			profit: -650,
			margin: null,
		});
		expect(
			report.body.positions.find(
				(p: { quantityUnit: string }) => p.quantityUnit === 'piece',
			).quantity,
		).toBe(2);
	});
	it('persists one warning per supplier/product cycle and resets only after a successful purchase from that supplier', async () => {
		await purchase(a, 1, 300);
		expect((await sell({ quantity: 1, revenue: 400 })).status).toBe(201);
		const claims = await Promise.all([warning(), warning(), warning()]);
		expect(claims.every((r) => r.status === 200)).toBe(true);
		expect(claims.reduce((sum, r) => sum + r.body.warnings.length, 0)).toBe(1);
		expect(await PurchaseWarning.countDocuments({ bayiId: b })).toBe(1);
		expect((await warning()).body.warnings).toHaveLength(0);
		const failed = await request(app)
			.post(ORDER_ROUTES.CREATE)
			.set('Authorization', auth)
			.send({ bayiId: b, lines: [{ ...product, quantity: 0 }] });
		expect(failed.status).toBe(400);
		expect((await warning()).body.warnings).toHaveLength(0);
		const failedSave = vi
			.spyOn(Order.prototype, 'save')
			.mockRejectedValueOnce(new Error('Simulated write failure'));
		try {
			const result = await request(app)
				.post(ORDER_ROUTES.CREATE)
				.set('Authorization', auth)
				.send({
					bayiId: b,
					lines: [{ ...product, quantity: 1, unitPriceOverride: 450 }],
				});
			expect(result.status).toBe(500);
		} finally {
			failedSave.mockRestore();
		}
		expect((await warning()).body.warnings).toHaveLength(0);
		await purchase(a, 1, 300);
		expect((await warning()).body.warnings).toHaveLength(0);
		await purchase(b, 1, 450);
		expect((await warning()).body.warnings).toHaveLength(1);
		expect((await warning()).body.warnings).toHaveLength(0);
		expect((await warning(a, 300)).body.warnings).toHaveLength(0);
		expect(
			(await warning(b, 300, { ...product, type: 'EMCP' })).body.warnings,
		).toHaveLength(0);
		await purchase(a, 1, 300, { ...product, type: 'EMCP' });
		expect(
			(await sell({ type: 'EMCP', quantity: 1, revenue: 400 })).status,
		).toBe(201);
		expect(
			(await warning(b, 450, { ...product, type: 'EMCP' })).body.warnings,
		).toHaveLength(1);
		expect((await warning()).body.warnings).toHaveLength(0);
	});
	it('rejects unauthenticated stock operations and invalid product/unit combinations', async () => {
		expect((await request(app).get(STOCK_ROUTES.LIST)).status).toBe(401);
		for (const path of [STOCK_ROUTES.SALES, STOCK_ROUTES.WARNINGS])
			expect((await request(app).post(path).send({})).status).toBe(401);
		expect((await sell({ quantityUnit: 'kg' })).status).toBe(400);
		expect((await stock({ from: '2026-02-30' })).status).toBe(400);
	});
});
