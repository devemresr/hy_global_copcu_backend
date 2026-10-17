import { describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../../app';
import { Item } from '../../models/Item';
import { User } from '../../models/User';
import { LogEvent, LOG_ACTIONS } from '../../models/LogEvent';
import { ITEMS_ROUTES } from '../../routes/routes.constant';
import { PERMISSIONS } from '../../constants/permissions.constant';
import { getVersion } from '../../services/sync/version.service';
import { loginAndGetTokens, TEST_USER } from '../helpers';

async function authorized() {
	await User.updateOne({ email: TEST_USER.email }, { $set: { permissions: [PERMISSIONS.ITEMS_DELETE] } });
	return (await loginAndGetTokens()).accessToken;
}

describe('DELETE /items/bulk', () => {
	it('soft-deletes only selected active rows with one version and one audit batch', async () => {
		const [first, second, untouched, alreadyDeleted] = await Item.create([
			{ model: 'FIRST', fiyat: 150 }, { model: 'SECOND' }, { model: 'UNTOUCHED' }, { model: 'OLD', deletedAt: new Date('2025-01-01') },
		]);
		// Prime the list cache so the test verifies invalidation as well.
		await request(app).get(ITEMS_ROUTES.LIST);
		const beforeVersion = getVersion();
		const token = await authorized();
		const missing = new mongoose.Types.ObjectId().toString();
		const response = await request(app).delete(ITEMS_ROUTES.BULK_DELETE).set('Authorization', `Bearer ${token}`).send({ ids: [String(first._id), String(second._id), String(first._id), String(alreadyDeleted._id), missing] });
		expect(response.status).toBe(200);
		expect(response.body).toMatchObject({ success: true, matchedCount: 2, deletedCount: 2 });
		const changed = await Item.find({ _id: { $in: [first._id, second._id] } }).lean();
		expect(changed.every((item) => item.deletedAt instanceof Date && item.version === beforeVersion + 1)).toBe(true);
		expect((await Item.findById(untouched._id))?.deletedAt).toBeNull();
		expect((await Item.findById(alreadyDeleted._id))?.deletedAt?.toISOString()).toBe('2025-01-01T00:00:00.000Z');
		expect(await Item.countDocuments()).toBe(4);
		const logs = await LogEvent.find({ action: LOG_ACTIONS.ITEMS_DELETE }).lean();
		expect(logs).toHaveLength(2);
		expect(new Set(logs.map((log) => log.batchId)).size).toBe(1);
		expect(logs[0].batchId).toBeTruthy();
		expect(logs.every((log) => log.version === beforeVersion + 1 && log.adminUsername === TEST_USER.username)).toBe(true);
		expect(logs.find((log) => log.entityKey === 'FIRST')?.fields).toContainEqual({ field: 'fiyat', previousValue: 150, newValue: null });
		const list = await request(app).get(ITEMS_ROUTES.LIST);
		expect(list.body.items.map((item: { model: string }) => item.model)).toEqual(['UNTOUCHED']);
		const changes = await request(app).get(`${ITEMS_ROUTES.CHANGES}?since=${beforeVersion}`);
		expect(changes.body.deleted.sort()).toEqual([String(first._id), String(second._id)].sort());
		const repeated = await request(app).delete(ITEMS_ROUTES.BULK_DELETE).set('Authorization', `Bearer ${token}`).send({ ids: [String(first._id), String(second._id)] });
		expect(repeated.body.deletedCount).toBe(0);
		expect(await LogEvent.countDocuments({ action: LOG_ACTIONS.ITEMS_DELETE })).toBe(2);
	});
	it('requires authentication and items:delete permission', async () => {
		const item = await Item.create({ model: 'PROTECTED' });
		expect((await request(app).delete(ITEMS_ROUTES.BULK_DELETE).send({ ids: [String(item._id)] })).status).toBe(401);
		const { accessToken } = await loginAndGetTokens();
		expect((await request(app).delete(ITEMS_ROUTES.BULK_DELETE).set('Authorization', `Bearer ${accessToken}`).send({ ids: [String(item._id)] })).status).toBe(403);
		expect((await Item.findById(item._id))?.deletedAt).toBeNull();
	});
	it('rejects empty, malformed and oversized selections without deleting rows', async () => {
		const token = await authorized();
		const item = await Item.create({ model: 'VALIDATE' });
		for (const body of [{}, { ids: [] }, { ids: ['not-an-id'] }, { ids: Array(1001).fill(String(item._id)) }, { ids: [String(item._id)], filter: {} }]) {
			const response = await request(app).delete(ITEMS_ROUTES.BULK_DELETE).set('Authorization', `Bearer ${token}`).send(body);
			expect(response.status).toBe(400);
		}
		expect((await Item.findById(item._id))?.deletedAt).toBeNull();
		expect(await LogEvent.countDocuments({ action: LOG_ACTIONS.ITEMS_DELETE })).toBe(0);
	});
});
