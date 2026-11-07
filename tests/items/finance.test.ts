import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import app from '../../app';
import { loginAndGetTokens } from '../helpers';
import { Bayi } from '../../models/Bayi';
import { Order } from '../../models/Order';
import { Item } from '../../models/Item';
import { FinanceEntry } from '../../models/Finance';
import { LogEvent } from '../../models/LogEvent';
import { ORDER_ROUTES, STOCK_ROUTES } from '../../routes/routes.constant';

let auth: string;
const bayiId = '000000000000000000000071';
beforeEach(async () => {
	auth = `Bearer ${(await loginAndGetTokens()).accessToken}`;
	await Bayi.create({
		_id: bayiId,
		name: 'Bayi',
		nameKey: 'bayi',
		phone: '+905551234567',
	});
});
const finance = (query = {}) =>
	request(app).get('/finance').set('Authorization', auth).query(query);
const entry = (body: object) =>
	request(app).post('/finance/entries').set('Authorization', auth).send(body);
describe('cash balance', () => {
	it('filters amounts before summaries without changing global cash balance', async () => {
		await entry({
			requestId: randomUUID(),
			categoryId: 'system:investment',
			amount: 100,
			date: '2026-11-01',
		}).expect(201);
		await entry({
			requestId: randomUUID(),
			categoryId: 'system:other',
			amount: 40,
			date: '2026-11-01',
		}).expect(201);
		const result = await finance({
			numericFilters: JSON.stringify([{ field: 'total', min: 80, max: 120 }]),
		}).expect(200);
		expect(result.body).toMatchObject({
			count: 1,
			income: 100,
			expenses: 0,
			net: 100,
			balance: 60,
		});
		await finance({
			numericFilters: JSON.stringify([{ field: 'quantityPiece', min: 1 }]),
		}).expect(400);
	});
	it('combines paid purchases, received sales and manual cash movements without creating inventory', async () => {
		const purchase = await request(app)
			.post(ORDER_ROUTES.CREATE)
			.set('Authorization', auth)
			.send({
				bayiId,
				lines: [
					{ type: 'EMMC', memoryGb: 8, quantity: 2, unitPriceOverride: 200 },
				],
			});
		expect(purchase.status).toBe(201);
		await Order.collection.updateOne(
			{ _id: (await Order.findOne())!._id },
			{ $set: { createdAt: new Date('2026-11-05T09:00:00Z') } },
		);
		const sale = await request(app)
			.post(STOCK_ROUTES.SALES)
			.set('Authorization', auth)
			.send({
				requestId: randomUUID(),
				mode: 'partial',
				lines: [
					{
						type: 'EMMC',
						memoryGb: 8,
						quantity: 1,
						quantityUnit: 'piece',
						revenue: 300,
					},
				],
			});
		expect(sale.status).toBe(201);
		const { StockRestock } = await import('../../models/StockRestock');
		await StockRestock.updateMany(
			{},
			{ $set: { createdAt: new Date('2026-11-05T12:00:00Z') } },
		);
		const category = await request(app)
			.post('/finance/categories')
			.set('Authorization', auth)
			.send({ requestId: randomUUID(), group: 'other', name: 'Nakliye' });
		expect(category.status).toBe(201);
		const expense = {
			requestId: randomUUID(),
			categoryId: category.body.category._id,
			amount: 100,
			date: '2026-11-05',
			description: 'Kargo bedeli',
		};
		expect((await entry(expense)).status).toBe(201);
		expect((await entry(expense)).status).toBe(200);
		expect(
			(
				await entry({
					requestId: randomUUID(),
					categoryId: 'system:investment',
					amount: 1000,
					date: '2026-10-01',
				})
			).status,
		).toBe(201);
		const report = await finance({
			from: '2026-11-01',
			until: '2026-11-30',
			pageSize: 1,
		});
		expect(report.status).toBe(200);
		expect(report.body).toMatchObject({
			balance: 800,
			income: 300,
			expenses: 500,
			net: -200,
			openingBalance: 1000,
			closingBalance: 800,
			count: 3,
			totalPages: 3,
		});
		expect(report.body.entries).toHaveLength(1);
		expect(
			(await finance({ group: 'other', categoryId: expense.categoryId })).body,
		).toMatchObject({ expenses: 100, income: 0, count: 1, balance: 800 });
		expect(await Item.countDocuments()).toBe(0);
		expect(await Order.countDocuments()).toBe(1);
		expect(await LogEvent.countDocuments({ entityType: 'finance_entry' })).toBe(
			2,
		);
		expect(
			(await request(app).get(STOCK_ROUTES.LIST).set('Authorization', auth))
				.body.positions[0].quantity,
		).toBe(1);
	});
	it('voids only manual entries once, retains the record, and validates amounts and dates', async () => {
		const input = {
			requestId: randomUUID(),
			categoryId: 'system:other',
			amount: 12.34,
			date: '2026-11-05',
		};
		expect((await entry(input)).status).toBe(201);
		expect((await entry({ ...input, amount: 15 })).status).toBe(409);
		for (let index = 0; index < 2; index++)
			expect(
				(
					await request(app)
						.delete(`/finance/entries/${input.requestId}`)
						.set('Authorization', auth)
				).status,
			).toBe(200);
		expect((await finance()).body.balance).toBe(0);
		expect(
			(await FinanceEntry.findById(input.requestId))!.voidedAt,
		).not.toBeNull();
		expect(
			await LogEvent.countDocuments({ action: 'finance:entry_void' }),
		).toBe(1);
		for (const invalid of [
			{ amount: 0 },
			{ amount: 1.001 },
			{ amount: -1 },
			{ date: '2026-02-30' },
			{ categoryId: 'missing' },
		])
			expect(
				(await entry({ ...input, requestId: randomUUID(), ...invalid })).status,
			).toBe(400);
		expect((await request(app).get('/finance')).status).toBe(401);
		expect(
			(await request(app).post('/finance/entries').send(input)).status,
		).toBe(401);
	});
	it('preserves total-price input exactly when its unit price has fractional cents', async () => {
		const result = await request(app)
			.post(ORDER_ROUTES.CREATE)
			.set('Authorization', auth)
			.send({
				bayiId,
				lines: [
					{ type: 'EMCP', memoryGb: 8, quantity: 3, totalPriceOverride: 100 },
				],
			});
		expect(result.status).toBe(201);
		expect(result.body.order.total).toBe(100);
		expect(result.body.order.lines[0].unitPrice).toBeCloseTo(100 / 3, 10);
		expect((await finance()).body.expenses).toBe(100);
		const stock = await request(app)
			.get(STOCK_ROUTES.LIST)
			.set('Authorization', auth);
		expect(stock.body.positions[0].averagePurchaseCost).toBeCloseTo(
			100 / 3,
			10,
		);
	});
});
