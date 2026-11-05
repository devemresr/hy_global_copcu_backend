import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../app';
import { ORDER_ROUTES } from '../../routes/routes.constant';
import { Order } from '../../models/Order';
import { Bayi } from '../../models/Bayi';
import { Item } from '../../models/Item';
import { loginAndGetTokens } from '../helpers';

const BAYI_ID = '000000000000000000000021';
const ORDER_PRICES: Record<string, Record<string, number>> = {
	EMMC: { 8: 40, 16: 80, 32: 180, 64: 300, 128: 500, 256: 820, 512: 1000 },
	EMCP: { 8: 55, 16: 100, 32: 230, 64: 600, 128: 800, 256: 1050, 512: 1200 },
	IPHONE: {},
	TABLET: {},
};
beforeEach(async () => {
	await Bayi.create({
		_id: BAYI_ID,
		name: 'Örnek Bayi',
		nameKey: 'örnek bayi',
		phone: '+905551234567',
	});
	await Item.insertMany(
		Object.entries(ORDER_PRICES).flatMap(([type, prices]) =>
			Object.entries(prices).map(([size, price]) => ({
				model: `${type}-${size}`,
				bellekTipi: type,
				depolama: Number(size),
				depolamaBirimi: 'GB',
				fiyat: price,
				paraBirimi: 'TRY',
			})),
		),
	);
});
const lines = [
	{ type: 'EMMC', memoryGb: 64, quantity: 2 },
	{ type: 'EMCP', memoryGb: 8, quantity: 5 },
];
describe('orders', () => {
	it('filters dealer names across pages and reports and treats search punctuation literally', async () => {
		const { accessToken } = await loginAndGetTokens();
		const auth = `Bearer ${accessToken}`;
		await Order.create([
			{
				name: 'Test (A) Bayi',
				lines: [],
				quantity: 1,
				total: 100,
				createdBy: BAYI_ID,
			},
			{
				name: 'Test (A) Bayi',
				lines: [],
				quantity: 2,
				total: 200,
				createdBy: BAYI_ID,
			},
			{
				name: 'Başka Bayi',
				lines: [],
				quantity: 3,
				total: 300,
				createdBy: BAYI_ID,
			},
		]);
		const result = await request(app)
			.get(ORDER_ROUTES.LIST)
			.set('Authorization', auth)
			.query({ bayiName: 'test (a)', pageSize: 1, minTotal: 150 });
		expect(result.status).toBe(200);
		expect(result.body.orders).toHaveLength(1);
		expect(result.body.summary).toMatchObject({ count: 1, total: 200 });
		const report = await request(app)
			.post(ORDER_ROUTES.REPORT)
			.set('Authorization', auth)
			.send({ bayiName: 'test (a)', pageSize: 1 });
		expect(report.status).toBe(200);
		expect(report.body.summary).toMatchObject({ count: 2, total: 300 });
		expect(report.body.timeline).toHaveLength(2);
	});
	it('saves unit-aware quantities without memory for count-only products or adding weights to piece counts', async () => {
		const { accessToken } = await loginAndGetTokens();
		const auth = `Bearer ${accessToken}`;
		const result = await request(app)
			.post(ORDER_ROUTES.CREATE)
			.set('Authorization', auth)
			.send({
				bayiId: BAYI_ID,
				lines: [
					{ type: 'EMMC', memoryGb: 64, quantity: 2 },
					{
						type: 'IPHONE',
						quantity: 1.25,
						quantityUnit: 'kg',
						unitPriceOverride: 100,
					},
					{
						type: 'TABLET',
						quantity: 250.5,
						quantityUnit: 'g',
						unitPriceOverride: 0.4,
					},
				],
			});
		expect(result.status).toBe(201);
		expect(result.body.order).toMatchObject({
			quantity: 2,
			total: 825.2,
			unitTotals: { piece: 2, kg: 1.25, g: 250.5 },
		});
		expect(result.body.order.lines[1]).toMatchObject({
			type: 'IPHONE',
			memoryGb: null,
			requiresMemorySize: false,
			quantityUnit: 'kg',
			quantity: 1.25,
			originalUnitPrice: null,
			total: 125,
		});
		const report = await request(app)
			.get(ORDER_ROUTES.LIST)
			.set('Authorization', auth);
		expect(report.body.summary).toMatchObject({
			quantity: 2,
			unitTotals: { piece: 2, kg: 1.25, g: 250.5 },
		});
		expect(report.body.byMemory).toEqual([
			{ _id: 64, total: 600, quantity: 2 },
		]);
		expect(report.body.byTypeAndMemory).toContainEqual(
			expect.objectContaining({
				type: 'IPHONE',
				memoryGb: null,
				quantityUnit: 'kg',
				quantity: 1.25,
			}),
		);
		const weightedMemory = await request(app)
			.post(ORDER_ROUTES.CREATE)
			.set('Authorization', auth)
			.send({
				bayiId: BAYI_ID,
				lines: [
					{ type: 'EMCP', memoryGb: 64, quantity: 1.5, quantityUnit: 'kg' },
				],
			});
		expect(weightedMemory.status).toBe(400);
		for (const line of [
			{ type: 'IPHONE', memoryGb: 64, quantity: 1, unitPriceOverride: 100 },
			{ type: 'EMMC', quantity: 1 },
			{
				type: 'IPHONE',
				quantity: 1.5,
				quantityUnit: 'piece',
				unitPriceOverride: 100,
			},
			{
				type: 'IPHONE',
				quantity: 0.0001,
				quantityUnit: 'g',
				unitPriceOverride: 100,
			},
		])
			expect(
				(
					await request(app)
						.post(ORDER_ROUTES.CREATE)
						.set('Authorization', auth)
						.send({ bayiId: BAYI_ID, lines: [line] })
				).status,
			).toBe(400);
	});
	it('accepts an applied unit price without inventing a missing list price or difference', async () => {
		const { accessToken } = await loginAndGetTokens();
		const auth = `Bearer ${accessToken}`;
		const saved = await request(app)
			.post(ORDER_ROUTES.CREATE)
			.set('Authorization', auth)
			.send({
				bayiId: BAYI_ID,
				lines: [
					{
						type: 'IPHONE',
						memoryGb: null,
						quantity: 2,
						unitPriceOverride: 250,
					},
				],
			});
		expect(saved.status).toBe(201);
		expect(saved.body.order.total).toBe(500);
		expect(saved.body.order.lines[0]).toMatchObject({
			originalUnitPrice: null,
			unitPrice: 250,
			priceAdjustment: null,
		});
		expect(saved.body.order.lines[0]).not.toHaveProperty('listPriceSource');
		const report = await request(app)
			.get(ORDER_ROUTES.LIST)
			.set('Authorization', auth);
		expect(report.body.adjustments).toEqual([]);
		expect(report.body.missingListPrices).toEqual([
			expect.objectContaining({
				type: 'IPHONE',
				memoryGb: null,
				unitPrice: 250,
				quantity: 2,
				total: 500,
			}),
		]);
		const zero = await request(app)
			.post(ORDER_ROUTES.CREATE)
			.set('Authorization', auth)
			.send({
				bayiId: BAYI_ID,
				lines: [
					{ type: 'TABLET', memoryGb: null, quantity: 1, unitPriceOverride: 0 },
				],
			});
		expect(zero.status).toBe(201);
		expect(zero.body.order.total).toBe(0);
	});
	it('accepts a manual list price only as the fallback for a missing catalog price', async () => {
		const { accessToken } = await loginAndGetTokens();
		const auth = `Bearer ${accessToken}`;
		const saved = await request(app)
			.post(ORDER_ROUTES.CREATE)
			.set('Authorization', auth)
			.send({
				bayiId: BAYI_ID,
				lines: [
					{
						type: 'IPHONE',
						memoryGb: null,
						quantity: 2,
						manualListPrice: 500,
						unitPriceOverride: 450,
					},
				],
			});
		expect(saved.status).toBe(201);
		expect(saved.body.order.total).toBe(900);
		expect(saved.body.order.lines[0]).toMatchObject({
			originalUnitPrice: 500,
			unitPrice: 450,
			priceAdjustment: -50,
		});
		const catalog = await request(app)
			.post(ORDER_ROUTES.CREATE)
			.set('Authorization', auth)
			.send({
				bayiId: BAYI_ID,
				lines: [
					{ type: 'EMMC', memoryGb: 64, quantity: 1, manualListPrice: 1 },
				],
			});
		expect(catalog.body.order.lines[0]).toMatchObject({
			originalUnitPrice: 300,
			unitPrice: 300,
		});
		const invalid = await request(app)
			.post(ORDER_ROUTES.CREATE)
			.set('Authorization', auth)
			.send({
				bayiId: BAYI_ID,
				lines: [
					{ type: 'TABLET', memoryGb: null, quantity: 1, manualListPrice: -1 },
				],
			});
		expect(invalid.status).toBe(400);
	});
	it('saves original and negotiated prices and reports changes across all matching pages', async () => {
		const { accessToken } = await loginAndGetTokens();
		const auth = `Bearer ${accessToken}`;
		const saved = await request(app)
			.post(ORDER_ROUTES.CREATE)
			.set('Authorization', auth)
			.send({
				bayiId: BAYI_ID,
				lines: [
					{ type: 'EMMC', memoryGb: 64, quantity: 3, unitPriceOverride: 280.5 },
				],
			});
		expect(saved.status).toBe(201);
		expect(saved.body.order.total).toBe(841.5);
		expect(saved.body.order.lines[0]).toMatchObject({
			originalUnitPrice: 300,
			unitPrice: 280.5,
			priceAdjustment: -19.5,
			total: 841.5,
		});
		await request(app)
			.post(ORDER_ROUTES.CREATE)
			.set('Authorization', auth)
			.send({
				bayiId: BAYI_ID,
				lines: [{ type: 'EMMC', memoryGb: 64, quantity: 1 }],
			});
		try {
			await Item.updateMany(
				{ bellekTipi: 'EMMC', depolama: 64 },
				{ $set: { fiyat: 500 } },
			);
			const report = await request(app)
				.get(ORDER_ROUTES.LIST)
				.query({ pageSize: 1 })
				.set('Authorization', auth);
			expect(report.body.orders).toHaveLength(1);
			expect(report.body.adjustments).toEqual([
				expect.objectContaining({
					orderName: 'Örnek Bayi',
					originalUnitPrice: 300,
					unitPrice: 280.5,
					priceAdjustment: -19.5,
					quantity: 3,
					totalAdjustment: -58.5,
				}),
			]);
		} finally {
			await Item.updateMany(
				{ bellekTipi: 'EMMC', depolama: 64 },
				{ $set: { fiyat: 300 } },
			);
		}
		const invalid = await request(app)
			.post(ORDER_ROUTES.CREATE)
			.set('Authorization', auth)
			.send({
				bayiId: BAYI_ID,
				lines: [
					{ type: 'EMMC', memoryGb: 64, quantity: 1, unitPriceOverride: -1 },
				],
			});
		expect(invalid.status).toBe(400);
	});
	it('requires authentication for pricing, history, and creation', async () => {
		for (const path of [ORDER_ROUTES.LIST, ORDER_ROUTES.PRICING])
			expect((await request(app).get(path)).status).toBe(401);
		expect(
			(
				await request(app)
					.post(ORDER_ROUTES.CREATE)
					.send({ bayiId: BAYI_ID, lines })
			).status,
		).toBe(401);
		expect((await request(app).post(ORDER_ROUTES.REPORT).send({})).status).toBe(
			401,
		);
	});
	it('calculates prices on the server and preserves saved price snapshots', async () => {
		const { accessToken } = await loginAndGetTokens();
		const auth = `Bearer ${accessToken}`;
		const saved = await request(app)
			.post(ORDER_ROUTES.CREATE)
			.set('Authorization', auth)
			.send({ bayiId: BAYI_ID, lines });
		expect(saved.status).toBe(201);
		expect(saved.body.order.name).toBe('Örnek Bayi');
		expect(saved.body.order).toMatchObject({
			total: 875,
			quantity: 7,
			lines: [
				{ unitPrice: 300, total: 600 },
				{ unitPrice: 55, total: 275 },
			],
		});
		try {
			await Item.updateMany(
				{ bellekTipi: 'EMMC', depolama: 64 },
				{ $set: { fiyat: 999 } },
			);
			const history = await request(app)
				.get(ORDER_ROUTES.LIST)
				.set('Authorization', auth);
			expect(history.body.orders[0].total).toBe(875);
			expect(history.body.orders[0].lines[0].unitPrice).toBe(300);
			expect(history.body.byType).toMatchObject([
				{ _id: 'EMMC', total: 600, quantity: 2 },
				{ _id: 'EMCP', total: 275, quantity: 5 },
			]);
			expect(history.body.byMemory).toEqual([
				{ _id: 8, total: 275, quantity: 5 },
				{ _id: 64, total: 600, quantity: 2 },
			]);
		} finally {
			await Item.updateMany(
				{ bellekTipi: 'EMMC', depolama: 64 },
				{ $set: { fiyat: 300 } },
			);
		}
	});
	it('requires a bayi and snapshots its name and phone without accepting a client-supplied name', async () => {
		const { accessToken } = await loginAndGetTokens();
		const auth = `Bearer ${accessToken}`;
		const saved = await request(app)
			.post(ORDER_ROUTES.CREATE)
			.set('Authorization', auth)
			.send({ bayiId: BAYI_ID, lines });
		expect(saved.status).toBe(201);
		expect(saved.body.order).toMatchObject({
			name: 'Örnek Bayi',
			bayiId: BAYI_ID,
			bayiPhone: '+905551234567',
		});
		await Bayi.findByIdAndUpdate(BAYI_ID, {
			name: 'Yeni ad',
			phone: '+905559876543',
		});
		const stored = await Order.findById(saved.body.order._id).lean();
		expect(stored).toMatchObject({
			name: 'Örnek Bayi',
			bayiPhone: '+905551234567',
		});
		const next = await request(app)
			.post(ORDER_ROUTES.CREATE)
			.set('Authorization', auth)
			.send({ bayiId: BAYI_ID, lines });
		expect(next.body.order).toMatchObject({
			name: 'Yeni ad',
			bayiPhone: '+905559876543',
		});
		for (const input of [
			{ lines },
			{ bayiId: 'invalid', lines },
			{ bayiId: '000000000000000000000099', lines },
			{ bayiId: BAYI_ID, name: 'Forged name', lines },
		]) {
			expect(
				(
					await request(app)
						.post(ORDER_ROUTES.CREATE)
						.set('Authorization', auth)
						.send(input)
				).status,
			).toBe(400);
		}
	});
	it('aggregates chart data over all filtered pages and includes more than 31 days', async () => {
		const { accessToken } = await loginAndGetTokens();
		await Order.collection.insertMany(
			Array.from({ length: 40 }, (_, index) => ({
				lines: [
					{
						type: 'EMMC',
						memoryGb: 64,
						quantity: 2,
						unitPrice: 300,
						total: 600,
					},
				],
				total: 600,
				quantity: 2,
				createdBy: '000000000000000000000001',
				createdAt: new Date(Date.UTC(2026, 9, index + 1, 12)),
			})),
		);
		const result = await request(app)
			.get(ORDER_ROUTES.LIST)
			.query({
				pageSize: 1,
				from: '2026-10-01',
				until: '2026-11-09',
				minTotal: 600,
				maxTotal: 600,
			})
			.set('Authorization', `Bearer ${accessToken}`);
		expect(result.status).toBe(200);
		expect(result.body.orders).toHaveLength(1);
		expect(result.body.daily).toHaveLength(40);
		expect(result.body.timeline).toHaveLength(40);
		expect(result.body.timeline[0]).toMatchObject({
			name: expect.any(String),
			total: 600,
			quantity: 2,
		});
		expect(result.body.timeline[0].createdAt).toBe('2026-10-01T12:00:00.000Z');
		const excludeIds = result.body.timeline
			.slice(0, 5)
			.map((order: { _id: string }) => order._id)
			.join(',');
		const selected = await request(app)
			.post(ORDER_ROUTES.REPORT)
			.send({
				from: '2026-10-01',
				until: '2026-11-09',
				minTotal: 600,
				maxTotal: 600,
				excludeIds,
				pageSize: 1,
			})
			.set('Authorization', `Bearer ${accessToken}`);
		expect(selected.status).toBe(200);
		expect(selected.body.orders).toHaveLength(1);
		expect(selected.body.timeline).toHaveLength(35);
		expect(selected.body.timeline[0].createdAt).toBe(
			'2026-10-06T12:00:00.000Z',
		);
		expect(selected.body.summary).toMatchObject({
			count: 35,
			quantity: 70,
			total: 21000,
		});
		expect(selected.body.byType).toMatchObject([
			{ _id: 'EMMC', quantity: 70, total: 21000 },
		]);
		const invalidSelection = await request(app)
			.post(ORDER_ROUTES.REPORT)
			.send({ excludeIds: 'invalid-id' })
			.set('Authorization', `Bearer ${accessToken}`);
		expect(invalidSelection.status).toBe(400);
		expect(result.body.daily[0]._id).toBe('2026-10-01');
		expect(result.body.daily[39]._id).toBe('2026-11-09');
		expect(result.body.byType).toMatchObject([
			{ _id: 'EMMC', quantity: 80, total: 24000 },
		]);
		expect(result.body.byMemory).toEqual([
			{ _id: 64, quantity: 80, total: 24000 },
		]);
		const empty = await request(app)
			.get(ORDER_ROUTES.LIST)
			.query({ minTotal: 601 })
			.set('Authorization', `Bearer ${accessToken}`);
		expect(empty.body.byType).toEqual([]);
		expect(empty.body.byMemory).toEqual([]);
		expect(empty.body.daily).toEqual([]);
		expect(empty.body.timeline).toEqual([]);
	});
	it('rejects placeholders, invalid quantities, unsupported sizes and client-supplied prices', async () => {
		const { accessToken } = await loginAndGetTokens();
		for (const body of [
			{ lines: [] },
			{ lines: [{ ...lines[0], type: 'IPHONE' }] },
			{ lines: [{ ...lines[0], type: 'TABLET' }] },
			{ lines: [{ ...lines[0], quantity: 0 }] },
			{ lines: [{ ...lines[0], quantity: 1.5 }] },
			{ lines: [{ ...lines[0], memoryGb: 55 }] },
			{ lines: [{ ...lines[0], memoryGb: 1024 }] },
			{ lines: [{ ...lines[0], unitPrice: 1 }] },
		])
			expect(
				(
					await request(app)
						.post(ORDER_ROUTES.CREATE)
						.set('Authorization', `Bearer ${accessToken}`)
						.send({ bayiId: BAYI_ID, ...body })
				).status,
			).toBe(400);
		expect(await Order.countDocuments()).toBe(0);
	});
	it('filters inclusive Istanbul dates and price ranges; summarizes all matching pages', async () => {
		const { accessToken } = await loginAndGetTokens();
		const auth = `Bearer ${accessToken}`;
		const createdBy = '000000000000000000000001';
		await Order.collection.insertMany([
			{
				lines: [],
				createdBy,
				total: 100,
				quantity: 1,
				createdAt: new Date('2026-11-03T20:59:59Z'),
			},
			{
				lines: [],
				createdBy,
				total: 200,
				quantity: 2,
				createdAt: new Date('2026-11-03T21:00:00Z'),
			},
			{
				lines: [],
				createdBy,
				total: 300,
				quantity: 3,
				createdAt: new Date('2026-11-04T20:59:59Z'),
			},
			{
				lines: [],
				createdBy,
				total: 400,
				quantity: 4,
				createdAt: new Date('2026-11-04T21:00:00Z'),
			},
		]);
		const result = await request(app)
			.get(ORDER_ROUTES.LIST)
			.query({
				from: '2026-11-04',
				until: '2026-11-04',
				minTotal: 200,
				maxTotal: 300,
				pageSize: 1,
			})
			.set('Authorization', auth);
		expect(result.status).toBe(200);
		expect(result.body.summary).toMatchObject({
			count: 2,
			total: 500,
			quantity: 5,
		});
		expect(result.body.orders).toHaveLength(1);
		expect(result.body.orders[0].total).toBe(300);
		expect(result.body.totalPages).toBe(2);
		expect(result.body.daily).toEqual([
			{ _id: '2026-11-04', total: 500, count: 2 },
		]);
		const empty = await request(app)
			.get(ORDER_ROUTES.LIST)
			.query({ maxTotal: 0 })
			.set('Authorization', auth);
		expect(empty.body.summary).toMatchObject({
			count: 0,
			total: 0,
			quantity: 0,
		});
		for (const query of [
			'from=2026-02-30',
			'from=2026-11-05&until=2026-11-04',
			'minTotal=300&maxTotal=200',
			'minTotal=-1',
			'pageSize=101',
		]) {
			expect(
				(
					await request(app)
						.get(`${ORDER_ROUTES.LIST}?${query}`)
						.set('Authorization', auth)
				).status,
			).toBe(400);
		}
	});
});
