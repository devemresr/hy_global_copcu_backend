import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import app from '../../app';
import { Order } from '../../models/Order';
import { FinanceEntry } from '../../models/Finance';
import { LogEvent, LOG_ACTIONS, LOG_ENTITY_TYPES } from '../../models/LogEvent';
import { User } from '../../models/User';
import { PartyDirectory } from '../../services/partyIdentity.service';
import { loginAndGetTokens } from '../helpers';

describe('stable party identities', () => {
	it('rejects ambiguous aliases and future parties while keeping explicit IDs authoritative', () => {
		const createdAt = new Date('2026-01-01');
		const directory = new PartyDirectory([
			{ _id: 'a', name: 'First', phone: '+905551234567', createdAt },
			{ _id: 'b', name: 'Second', phone: '+905551234568', createdAt },
		]);
		directory.remember('a', 'Old name');
		directory.remember('b', 'Old name');
		expect(directory.resolve({ name: 'Old name' })).toBeNull();
		expect(
			directory.resolve({ name: 'Old name', phone: '+905551234567' }),
		).toBe('a');
		expect(
			directory.resolve({ name: 'First', createdAt: new Date('2025-01-01') }),
		).toBeNull();
		expect(directory.resolve({ id: 'removed-id', name: 'Second' })).toBe(
			'removed-id',
		);
	});
	it('keeps purchase and log snapshots across renames and reused bayi names', async () => {
		const auth = 'Bearer ' + (await loginAndGetTokens()).accessToken;
		const created = await request(app)
			.post('/bayiler')
			.set('Authorization', auth)
			.send({ name: 'Eski bayi', phone: '05551234567' })
			.expect(201);
		const id = created.body.bayi._id;
		const purchase = await request(app)
			.post('/orders')
			.set('Authorization', auth)
			.send({
				bayiId: id,
				lines: [
					{ type: 'EMCP', memoryGb: 8, quantity: 2, unitPriceOverride: 10 },
				],
			})
			.expect(201);
		const user = (await User.findOne())!;
		const legacy = await Order.create({
			name: 'Eski bayi',
			bayiPhone: '+905551234567',
			createdBy: user._id,
			lines: [
				{ type: 'EMCP', memoryGb: 8, quantity: 1, unitPrice: 5, total: 5 },
			],
			quantity: 1,
			total: 5,
		});
		const oldLog = await LogEvent.create({
			adminId: user._id,
			adminUsername: user.username,
			action: LOG_ACTIONS.STOCK_PURCHASE_CREATE,
			entityType: LOG_ENTITY_TYPES.STOCK_PURCHASE,
			entityId: legacy._id,
			entityKey: 'Eski bayi · eMCP 8 GB',
			fields: [],
		});
		await request(app)
			.patch('/bayiler/' + id)
			.set('Authorization', auth)
			.send({ name: 'Yeni bayi', phone: '05551234567' })
			.expect(200);
		const report = await request(app)
			.get('/orders')
			.query({ bayiId: id })
			.set('Authorization', auth)
			.expect(200);
		expect(report.body.summary).toMatchObject({ count: 2, total: 25 });
		expect(report.body.orders).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: 'Eski bayi',
					currentBayiName: 'Yeni bayi',
					bayiId: id,
				}),
			]),
		);
		expect(String((await Order.findById(legacy._id))!.bayiId)).toBe(id);
		expect((await Order.findById(purchase.body.order._id))!.name).toBe(
			'Eski bayi',
		);
		expect((await LogEvent.findById(oldLog._id))!.entityKey).toBe(
			'Eski bayi · eMCP 8 GB',
		);
		const stock = await request(app)
			.get('/stock')
			.query({ bayiId: id, movementType: 'purchase-entries' })
			.set('Authorization', auth)
			.expect(200);
		expect(stock.body.movements).toHaveLength(2);
		expect(stock.body.movements[0]).toMatchObject({
			bayiId: id,
			bayiName: 'Eski bayi',
			currentBayiName: 'Yeni bayi',
		});
		const audit = await request(app)
			.get('/log-events')
			.query({ bayiId: id })
			.set('Authorization', auth)
			.expect(200);
		expect(audit.body.events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					action: 'bayi:update',
					bayiId: id,
					fields: expect.arrayContaining([
						expect.objectContaining({
							field: 'name',
							previousValue: 'Eski bayi',
							newValue: 'Yeni bayi',
						}),
					]),
				}),
			]),
		);
		expect(
			audit.body.events.find(
				(event: { _id: string }) => event._id === String(oldLog._id),
			),
		).toMatchObject({ currentBayiName: 'Yeni bayi', bayiName: 'Eski bayi' });
		const reused = await request(app)
			.post('/bayiler')
			.set('Authorization', auth)
			.send({ name: 'Eski bayi', phone: '05551234568' })
			.expect(201);
		const noOldRecords = await request(app)
			.get('/orders')
			.query({ bayiId: reused.body.bayi._id })
			.set('Authorization', auth)
			.expect(200);
		expect(noOldRecords.body.summary.count).toBe(0);
		expect(
			(
				await request(app)
					.get('/finance')
					.query({ bayiId: id })
					.set('Authorization', auth)
					.expect(200)
			).body.count,
		).toBe(2);
	});
	it('retains investor identities in cash records, edits and cancellation logs', async () => {
		const auth = 'Bearer ' + (await loginAndGetTokens()).accessToken;
		const created = await request(app)
			.post('/finance/investors')
			.set('Authorization', auth)
			.send({
				requestId: randomUUID(),
				name: 'Eski yatırımcı',
				phone: '05551234567',
			})
			.expect(201);
		const id = created.body.investor._id;
		const entry = await request(app)
			.post('/finance/entries')
			.set('Authorization', auth)
			.send({
				requestId: randomUUID(),
				categoryId: 'system:investment',
				amount: 100,
				date: '2026-11-12',
				investorId: id,
				description: '',
			})
			.expect(201);
		const user = (await User.findOne())!;
		const legacy = await FinanceEntry.create({
			_id: randomUUID(),
			categoryId: 'system:investment',
			group: 'investment',
			subtype: 'Yatırım',
			amountCents: 5000,
			date: '2026-11-12',
			investorName: 'Eski yatırımcı',
			createdBy: user._id,
		});
		await request(app)
			.put('/finance/investors/' + id)
			.set('Authorization', auth)
			.send({
				requestId: randomUUID(),
				name: 'Yeni yatırımcı',
				phone: '05551234567',
			})
			.expect(200);
		const report = await request(app)
			.get('/finance')
			.query({ investorId: id })
			.set('Authorization', auth)
			.expect(200);
		expect(report.body).toMatchObject({
			count: 2,
			income: 150,
			showRunningBalance: false,
		});
		expect(report.body.entries[0]).toMatchObject({
			investorId: id,
			investorName: 'Eski yatırımcı',
			currentInvestorName: 'Yeni yatırımcı',
		});
		expect((await FinanceEntry.findById(legacy._id))!.investorId).toBe(id);
		expect(
			(await FinanceEntry.findById(entry.body.entry._id))!.investorName,
		).toBe('Eski yatırımcı');
		await request(app)
			.delete('/finance/entries/' + entry.body.entry._id)
			.set('Authorization', auth)
			.expect(200);
		const audit = await request(app)
			.get('/log-events')
			.query({ investorId: id })
			.set('Authorization', auth)
			.expect(200);
		expect(audit.body.events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					action: 'finance:investor_update',
					investorId: id,
					currentInvestorName: 'Yeni yatırımcı',
					fields: expect.arrayContaining([
						expect.objectContaining({
							field: 'name',
							previousValue: 'Eski yatırımcı',
							newValue: 'Yeni yatırımcı',
						}),
					]),
				}),
				expect.objectContaining({
					action: 'finance:entry_void',
					investorId: id,
					investorName: 'Eski yatırımcı',
					currentInvestorName: 'Yeni yatırımcı',
				}),
			]),
		);
	});
});
