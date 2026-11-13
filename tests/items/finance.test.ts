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
						bayiId,
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

it('creates and reuses investors, snapshots their names and validates investment links', async () => {
	const requestId = randomUUID();
	await request(app).get('/finance/investors').expect(401);
	await request(app)
		.post('/finance/investors')
		.send({ requestId, name: 'Investor' })
		.expect(401);
	const create = (body: object) =>
		request(app)
			.post('/finance/investors')
			.set('Authorization', auth)
			.send({ phone: '05551234567', ...body });
	const investor = await create({
		requestId,
		name: '  İnci   Yılmaz  ',
	}).expect(201);
	expect(investor.body.investor.name).toBe('İnci Yılmaz');
	expect(
		(await create({ requestId: randomUUID(), name: 'inci yılmaz' }).expect(200))
			.body.investor._id,
	).toBe(requestId);
	await create({ requestId, name: 'İnci Yılmaz' }).expect(200);
	await create({ requestId, name: 'Another investor' }).expect(409);
	await create({ requestId: randomUUID(), name: '   ' }).expect(400);
	const listing = await request(app)
		.get('/finance/investors')
		.set('Authorization', auth)
		.expect(200);
	expect(listing.body.investors).toHaveLength(1);
	const input = {
		requestId: randomUUID(),
		categoryId: 'system:investment',
		investorId: requestId,
		amount: 100,
		date: '2026-11-05',
	};
	await entry(input).expect(201);
	await entry(input).expect(200);
	const report = await finance().expect(200);
	expect(report.body.entries[0]).toMatchObject({
		investorId: requestId,
		investorName: 'İnci Yılmaz',
		amount: 100,
	});
	await entry({ ...input, investorId: undefined }).expect(409);
	await entry({
		...input,
		requestId: randomUUID(),
		investorId: randomUUID(),
	}).expect(400);
	await entry({
		...input,
		requestId: randomUUID(),
		categoryId: 'system:other',
	}).expect(400);
	expect(
		await LogEvent.countDocuments({ action: 'finance:investor_create' }),
	).toBe(1);
});

it('normalizes investor phones, reuses duplicate numbers and rejects collisions when editing', async () => {
	const create = (name: string, phone: string) =>
		request(app)
			.post('/finance/investors')
			.set('Authorization', auth)
			.send({ requestId: randomUUID(), name, phone });
	await create('Invalid', '12345678901234567890').expect(400);
	const first = await create('One', '05551234567').expect(201);
	expect(first.body.investor.phone).toBe('+905551234567');
	const duplicate = await create('Different name', '+90 555 123 45 67').expect(
		200,
	);
	expect(duplicate.body.investor._id).toBe(first.body.investor._id);
	const second = await create('Two', '05551234568').expect(201);
	await request(app)
		.put('/finance/investors/' + second.body.investor._id)
		.set('Authorization', auth)
		.send({ requestId: randomUUID(), name: 'Two', phone: '05551234567' })
		.expect(409);
	const { Investor } = await import('../../models/Investor');
	const legacyId = randomUUID();
	await Investor.create({
		_id: legacyId,
		name: 'Legacy',
		nameKey: 'legacy',
		createdBy: first.body.investor.createdBy,
	});
	await request(app)
		.put('/finance/investors/' + legacyId)
		.set('Authorization', auth)
		.send({ requestId: randomUUID(), name: 'Legacy', phone: '05551234569' })
		.expect(200);
	expect((await Investor.findById(legacyId))!.phone).toBe('+905551234569');
	expect(
		await LogEvent.countDocuments({ action: 'finance:investor_update' }),
	).toBe(1);
});

it('calculates chronological balances and daily totals before pagination, and hides balances for partial ledgers', async () => {
	const inputs = [
		{ date: '2026-11-01', categoryId: 'system:investment', amount: 100 },
		{ date: '2026-11-02', categoryId: 'system:other', amount: 20 },
		{ date: '2026-11-02', categoryId: 'system:investment', amount: 50 },
		{ date: '2026-11-02', categoryId: 'system:other', amount: 10 },
	];
	for (let index = 0; index < inputs.length; index++) {
		const requestId = randomUUID();
		await entry({ requestId, ...inputs[index] }).expect(201);
		await FinanceEntry.updateOne(
			{ _id: requestId },
			{ $set: { createdAt: new Date('2026-11-02T09:00:0' + index + 'Z') } },
		);
	}
	const first = await finance({
		from: '2026-11-02',
		until: '2026-11-02',
		pageSize: 1,
	}).expect(200);
	expect(first.body).toMatchObject({
		showRunningBalance: true,
		count: 3,
		balance: 120,
		openingBalance: 100,
		closingBalance: 120,
		daily: [
			{ date: '2026-11-02', count: 3, income: 50, expenses: 30, net: 20 },
		],
	});
	expect(first.body.entries[0]).toMatchObject({
		amount: 10,
		balanceBefore: 130,
		balanceAfter: 120,
	});
	const second = await finance({
		from: '2026-11-02',
		page: 2,
		pageSize: 1,
	}).expect(200);
	expect(second.body.entries[0]).toMatchObject({
		amount: 50,
		balanceBefore: 80,
		balanceAfter: 130,
	});
	expect(second.body.daily).toEqual(first.body.daily);
	for (const filters of [
		{ direction: 'income' },
		{ direction: 'expense' },
		{ group: 'sale' },
		{ categoryId: 'system:other' },
		{ minTotal: 30 },
		{ numericFilters: JSON.stringify([{ field: 'total', min: 30 }]) },
	]) {
		const filtered = await finance(filters).expect(200);
		expect(filtered.body.showRunningBalance).toBe(false);
		for (const row of filtered.body.entries) {
			expect(row).not.toHaveProperty('balanceAfter');
			expect(row).not.toHaveProperty('balanceBefore');
		}
	}
	const incomes = await finance({
		direction: 'income',
		from: '2026-11-02',
	}).expect(200);
	expect(incomes.body.daily).toEqual([
		{ date: '2026-11-02', count: 1, income: 50, expenses: 0, net: 50 },
	]);
});

it('limits manual entries to income and other expenses, and edits unique financial subtypes without duplicating defaults', async () => {
	for (const categoryId of ['system:purchase', 'system:sale']) {
		await entry({
			requestId: randomUUID(),
			categoryId,
			amount: 10,
			date: '2026-11-12',
		}).expect(400);
	}
	const create = (group: string, name: string) =>
		request(app)
			.post('/finance/categories')
			.set('Authorization', auth)
			.send({ requestId: randomUUID(), group, name });
	await create('purchase', 'Unexplained purchase').expect(400);
	await create('sale', 'Unexplained sale').expect(400);
	await create('other', 'Gider').expect(400);
	await create('investment', 'Diğer').expect(409);
	const created = await create('other', '  Nakliye   gideri ').expect(201);
	await create('investment', 'nakliye gideri').expect(409);
	const id = created.body.category._id;
	await entry({
		requestId: randomUUID(),
		categoryId: id,
		amount: 20,
		date: '2026-11-12',
	}).expect(201);
	const edit = (id: string, group: string, name: string) =>
		request(app)
			.put('/finance/categories/' + encodeURIComponent(id))
			.set('Authorization', auth)
			.send({ requestId: randomUUID(), group, name });
	await edit(id, 'investment', 'Moving income').expect(400);
	await edit(id, 'other', 'Taşıma').expect(200);
	await edit('system:other', 'other', 'Taşıma').expect(409);
	await edit('system:other', 'other', 'Çeşitli gider').expect(200);
	const result = await finance().expect(200);
	expect(
		result.body.categories.filter(
			(row: { _id: string }) => row._id === 'system:other',
		),
	).toHaveLength(1);
	expect(
		result.body.categories.find(
			(row: { _id: string }) => row._id === 'system:other',
		).name,
	).toBe('Çeşitli gider');
	expect(result.body.entries[0]).toMatchObject({
		subtype: 'Nakliye gideri',
		amount: 20,
		group: 'other',
	});
	expect(
		await LogEvent.countDocuments({ action: 'finance:category_update' }),
	).toBe(2);
	await request(app)
		.put('/finance/categories/' + id)
		.send({ requestId: randomUUID(), group: 'other', name: 'x' })
		.expect(401);
});
