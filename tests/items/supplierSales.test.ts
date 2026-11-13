import { beforeEach, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import app from '../../app';
import { Bayi } from '../../models/Bayi';
import { User } from '../../models/User';
import { StockRestock } from '../../models/StockRestock';
import { loginAndGetTokens } from '../helpers';
let auth: string;
let a: string;
let b: string;
beforeEach(async () => {
	auth = 'Bearer ' + (await loginAndGetTokens()).accessToken;
	const rows = await Bayi.create([
		{ name: 'A', nameKey: 'a', phone: '+905551234567' },
		{ name: 'B', nameKey: 'b', phone: '+905551234568' },
	]);
	a = String(rows[0]._id);
	b = String(rows[1]._id);
});
const product = { type: 'EMCP', memoryGb: 8, quantityUnit: 'piece' };
async function buy(
	bayiId: string,
	quantity: number,
	price: number,
	quantityUnit = 'piece',
) {
	const result = await request(app)
		.post('/orders')
		.set('Authorization', auth)
		.send({
			bayiId,
			lines: [{ ...product, quantityUnit, quantity, unitPriceOverride: price }],
		})
		.expect(201);
	return result.body.order;
}
const sell = (mode: string, lines: object[], requestId = randomUUID()) =>
	request(app)
		.post('/stock/sales')
		.set('Authorization', auth)
		.send({ requestId, mode, lines });
const report = (query = {}) =>
	request(app).get('/stock').set('Authorization', auth).query(query);
it('requires a supplier for partial sales and rejects overlapping or excessive quantities atomically', async () => {
	await buy(a, 30, 100);
	await buy(b, 10, 300);
	await sell('partial', [{ ...product, quantity: 1, revenue: 200 }]).expect(
		400,
	);
	await sell('partial', [
		{ ...product, bayiId: b, quantity: 11, revenue: 1000 },
	]).expect(400);
	await sell('partial', [
		{ ...product, bayiId: a, quantity: 2, revenue: 100 },
		{ ...product, bayiId: a, quantity: 3, revenue: 100 },
	]).expect(400);
	await sell('complete', [
		{ ...product, quantity: 40, revenue: 1000 },
		{ ...product, bayiId: a, quantity: 30, revenue: 1000 },
	]).expect(400);
	expect(await StockRestock.countDocuments()).toBe(0);
	expect((await report().expect(200)).body.positions[0].quantity).toBe(40);
});
it('freezes exact supplier costs and full-stock revenue splits, and filters sales by stable bayi ID', async () => {
	await buy(a, 30, 100);
	await buy(b, 10, 300);
	const partial = await sell('partial', [
		{ ...product, bayiId: a, quantity: 10, revenue: 2000 },
	]).expect(201);
	expect(partial.body.operation.lines[0]).toMatchObject({
		costOfGoods: 1000,
		suppliers: [{ bayiId: a, quantity: 10, revenue: 2000, costOfGoods: 1000 }],
	});
	const allInput = [{ ...product, quantity: 30, revenue: 6000 }];
	const id = randomUUID();
	const full = await sell('complete', allInput, id).expect(201);
	expect(full.body.operation.lines[0].suppliers).toEqual(
		expect.arrayContaining([
			{
				bayiId: a,
				bayiName: 'A',
				quantity: 20,
				revenue: 4000,
				costOfGoods: 2000,
			},
			{
				bayiId: b,
				bayiName: 'B',
				quantity: 10,
				revenue: 2000,
				costOfGoods: 3000,
			},
		]),
	);
	await sell('complete', allInput, id).expect(201);
	expect(await StockRestock.countDocuments()).toBe(2);
	const onlyB = await report({ bayiId: b, movementType: 'all-sales' }).expect(
		200,
	);
	expect(onlyB.body.reportTotals).toMatchObject({
		revenue: 2000,
		profit: -1000,
	});
	expect(onlyB.body.profitsByBayi).toMatchObject([
		{ bayiId: b, quantity: 10, costOfGoods: 3000, profit: -1000, margin: -50 },
	]);
	expect((await report().expect(200)).body.positions[0].quantity).toBe(0);
	await request(app)
		.patch('/bayiler/' + b)
		.set('Authorization', auth)
		.send({ name: 'B renamed', phone: '05551234568' })
		.expect(200);
	const audit = await request(app)
		.get('/log-events')
		.set('Authorization', auth)
		.query({ bayiId: b, types: 'stock_restock' })
		.expect(200);
	expect(audit.body.events).toHaveLength(1);
	expect(audit.body.events[0].bayis).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				bayiId: b,
				bayiName: 'B',
				currentBayiName: 'B renamed',
			}),
		]),
	);
});
it('accepts the same product from different suppliers and keeps gram/kg allocation separate from pieces', async () => {
	await buy(a, 500, 2, 'g');
	await buy(b, 1, 1000, 'kg');
	const sold = await sell('partial', [
		{ ...product, bayiId: a, quantityUnit: 'g', quantity: 250, revenue: 750 },
		{ ...product, bayiId: b, quantityUnit: 'kg', quantity: 0.5, revenue: 1000 },
	]).expect(201);
	expect(sold.body.operation.totalCostOfGoods).toBe(1000);
	expect(
		sold.body.operation.lines.map(
			(line: { quantity: number }) => line.quantity,
		),
	).toEqual([0.25, 0.5]);
	const state = await report().expect(200);
	expect(state.body.positions[0].quantity).toBe(0.75);
	expect(state.body.positions[0].suppliers).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ bayiId: a, quantity: 0.25 }),
			expect.objectContaining({ bayiId: b, quantity: 0.5 }),
		]),
	);
});
it('carries legacy pooled stock value forward without rewriting historical sale costs', async () => {
	const order = await buy(a, 30, 100);
	await buy(b, 10, 300);
	const user = (await User.findOne())!;
	const legacy = await StockRestock.create({
		_id: randomUUID(),
		requestId: randomUUID(),
		mode: 'partial',
		createdBy: user._id,
		createdAt: new Date(),
		totalRevenue: 2000,
		totalCostOfGoods: 1500,
		lines: [
			{
				...product,
				quantity: 10,
				revenue: 2000,
				costOfGoods: 1500,
				averagePurchaseCost: 150,
				previousQuantity: 40,
				remainingQuantity: 30,
				allocations: [{ lotId: order._id + ':0', quantity: 10 }],
			},
		],
	});
	const after = await sell('partial', [
		{ ...product, bayiId: b, quantity: 5, revenue: 1000 },
	]).expect(201);
	expect(after.body.operation.totalCostOfGoods).toBe(750);
	const state = await report().expect(200);
	expect(state.body.positions[0]).toMatchObject({
		quantity: 25,
		averagePurchaseCost: 150,
	});
	expect((await StockRestock.findById(legacy._id))!.totalCostOfGoods).toBe(
		1500,
	);
});
