import { beforeEach, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import app from '../../app';
import { Bayi } from '../../models/Bayi';
import { Order } from '../../models/Order';
import { StockRestock } from '../../models/StockRestock';
import { loginAndGetTokens } from '../helpers';

const ids = [
	'000000000000000000000081',
	'000000000000000000000082',
	'000000000000000000000083',
];
let auth: string;
const period = { from: '2026-11-10', until: '2026-11-11' };
const query = (path: string, filters = {}) =>
	request(app)
		.get(path)
		.set('Authorization', auth)
		.query({ ...period, bayiIds: ids.slice(0, 2).join(','), ...filters });

beforeEach(async () => {
	auth = `Bearer ${(await loginAndGetTokens()).accessToken}`;
	await Bayi.create(
		ids.map((_id, index) => ({
			_id,
			name: `Supplier ${index}`,
			nameKey: `supplier ${index}`,
			phone: `+90555123000${index}`,
		})),
	);
	for (const [index, type, memoryGb, quantity, price] of [
		[0, 'EMMC', 8, 2, 10],
		[1, 'EMMC', 8, 6, 20],
		[2, 'EMMC', 16, 2, 50],
		[0, 'EMCP', 8, 3, 5],
	] as const) {
		await request(app)
			.post('/orders')
			.set('Authorization', auth)
			.send({
				bayiId: ids[index],
				lines: [{ type, memoryGb, quantity, unitPriceOverride: price }],
			})
			.expect(201);
	}
	await Order.collection.updateMany(
		{},
		{ $set: { createdAt: new Date('2026-11-10T09:00:00Z') } },
	);
	await request(app)
		.post('/stock/sales')
		.set('Authorization', auth)
		.send({
			requestId: randomUUID(),
			mode: 'complete',
			lines: [
				{
					type: 'EMMC',
					memoryGb: 8,
					quantityUnit: 'piece',
					quantity: 8,
					revenue: 240,
				},
			],
		})
		.expect(201);
	await StockRestock.collection.updateMany(
		{},
		{ $set: { createdAt: new Date('2026-11-11T09:00:00Z') } },
	);
});

it('filters purchase totals by multiple bayi IDs, product scope and inclusive dates before pagination', async () => {
	const result = await query('/orders', {
		pageSize: 1,
		numericFilters: JSON.stringify([
			{ field: 'lineTotal', productType: 'EMMC', memoryGb: 8, min: 0 },
		]),
	}).expect(200);
	expect(result.body.summary).toMatchObject({ count: 2, total: 140 });
	expect(result.body.orders).toHaveLength(1);
	expect(result.body.bayiFilterName).toBe('Supplier 0, Supplier 1');
	const outside = await query('/orders', {
		until: '2026-11-09',
		from: '2026-11-09',
	}).expect(200);
	expect(outside.body.summary.count).toBe(0);
	await query('/orders', { bayiIds: 'invalid' }).expect(400);
});

it('filters stock supplier quantities and profits without duplicating sale lines or altering inventory', async () => {
	const result = await query('/stock', {
		numericFilters: JSON.stringify([
			{ field: 'lineTotal', productType: 'EMMC', min: 0 },
		]),
	}).expect(200);
	expect(result.body.reportTotals).toMatchObject({
		purchaseCost: 140,
		revenue: 240,
		costOfGoods: 140,
	});
	const single = await query('/stock', {
		bayiIds: ids[0],
		movementType: 'all-sales',
	}).expect(200);
	expect(single.body.reportTotals).toMatchObject({
		revenue: 60,
		costOfGoods: 20,
	});
	expect(single.body.profitsByBayi).toEqual([
		expect.objectContaining({ bayiId: ids[0], quantity: 2, profit: 40 }),
	]);
	expect(
		single.body.positions.find((row: { type: string }) => row.type === 'EMCP')
			.quantity,
	).toBe(3);
});

it('filters balance totals across selected bayis while preserving the global balance', async () => {
	const result = await query('/finance', { pageSize: 1 }).expect(200);
	expect(result.body).toMatchObject({
		count: 4,
		income: 240,
		expenses: 155,
		net: 85,
		balance: -15,
		showRunningBalance: false,
	});
	expect(result.body.entries).toHaveLength(1);
	const single = await query('/finance', { bayiIds: ids[0] }).expect(200);
	expect(single.body).toMatchObject({
		income: 60,
		expenses: 35,
		net: 25,
		balance: -15,
	});
});

it('keeps whole operations together, totals complete days and links supplier sales to source purchases', async () => {
	const result = await query('/stock', { pageSize: 1 }).expect(200);
	expect(result.body.activityCount).toBe(4);
	expect(result.body.activities).toHaveLength(1);
	expect(result.body.activities[0].kind).toBe('complete');
	expect(result.body.dailyMovementTotals).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				date: '2026-11-10',
				count: 3,
				purchaseCost: 155,
			}),
			expect.objectContaining({
				date: '2026-11-11',
				count: 1,
				revenue: 240,
				profit: 100,
			}),
		]),
	);
	const parts = result.body.activities[0].lines[0].suppliers;
	expect(
		parts.map((part: { quantity: number }) => part.quantity).sort(),
	).toEqual([2, 6]);
	for (const part of parts) {
		expect(part.sourcePurchases).toHaveLength(1);
		expect(part.sourcePurchases[0].quantity).toBe(part.quantity);
		const purchase = await query('/orders', {
			purchaseId: part.sourcePurchases[0].orderId,
		}).expect(200);
		expect(purchase.body.orders).toHaveLength(1);
		expect(purchase.body.orders[0].bayiId).toBe(part.bayiId);
	}
	expect(result.body.bayiReports).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				bayiId: ids[0],
				purchaseCost: 35,
				costOfGoods: 20,
				revenue: 60,
				profit: 40,
			}),
			expect.objectContaining({
				bayiId: ids[1],
				purchaseCost: 120,
				costOfGoods: 120,
				revenue: 180,
				profit: 60,
			}),
		]),
	);
	const single = await query('/stock', {
		bayiIds: ids[0],
		movementType: 'all-sales',
	}).expect(200);
	expect(single.body.activities[0].lines[0].suppliers).toHaveLength(1);
	expect(single.body.activities[0].lines[0].suppliers[0].bayiId).toBe(ids[0]);
});
it('paginates a multi-product purchase as one operation instead of splitting its product rows', async () => {
	const created = await request(app)
		.post('/orders')
		.set('Authorization', auth)
		.send({
			bayiId: ids[0],
			lines: [
				{ type: 'EMMC', memoryGb: 32, quantity: 2, unitPriceOverride: 10 },
				{ type: 'EMCP', memoryGb: 32, quantity: 3, unitPriceOverride: 5 },
			],
		})
		.expect(201);
	const { Types } = await import('mongoose');
	await Order.collection.updateOne(
		{ _id: new Types.ObjectId(created.body.order._id) },
		{ $set: { createdAt: new Date('2026-11-10T18:00:00Z') } },
	);
	const result = await query('/stock', {
		until: '2026-11-10',
		pageSize: 1,
	}).expect(200);
	expect(result.body.activities).toHaveLength(1);
	expect(result.body.activities[0].lines).toHaveLength(2);
	expect(result.body.activityCount).toBe(4);
	expect(result.body.dailyMovementTotals[0]).toMatchObject({
		count: 4,
		purchaseCost: 190,
	});
});

it('excludes selected sales from merged reports while keeping live stock and filtered purchases intact', async () => {
	const requestId = randomUUID();
	await request(app)
		.post('/stock/sales')
		.set('Authorization', auth)
		.send({
			requestId,
			mode: 'partial',
			lines: [
				{
					type: 'EMCP',
					memoryGb: 8,
					quantityUnit: 'piece',
					bayiId: ids[0],
					quantity: 1,
					revenue: 10,
				},
			],
		})
		.expect(201);
	await StockRestock.collection.updateOne(
		{ requestId },
		{ $set: { createdAt: new Date('2026-11-11T12:00:00Z') } },
	);
	const result = await query('/stock', {
		excludeSaleIds: requestId,
		pageSize: 1,
	}).expect(200);
	expect(result.body.matchingSaleIds).toHaveLength(2);
	expect(result.body.selectedSaleCount).toBe(1);
	expect(result.body.reportSales).toHaveLength(1);
	expect(result.body.reportSales[0].requestId).not.toBe(requestId);
	expect(result.body.reportTotals).toMatchObject({
		purchaseCost: 155,
		revenue: 240,
		costOfGoods: 140,
		profit: 100,
	});
	expect(result.body.productSummary).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				type: 'EMCP',
				memoryGb: 8,
				purchaseQuantity: 3,
				purchaseTotal: 15,
				soldQuantity: 0,
				currentQuantity: 2,
				averagePurchasePrice: 5,
				averageSellingPrice: null,
				margin: null,
			}),
			expect.objectContaining({
				type: 'EMMC',
				memoryGb: 8,
				soldQuantity: 8,
				currentQuantity: 0,
				averagePurchasePrice: 17.5,
				averageSellingPrice: 30,
			}),
		]),
	);
	expect(result.body.reportGeneratedAt).toEqual(expect.any(String));
	await query('/stock', { excludeSaleIds: 'invalid' }).expect(400);
});
