import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../app';
import { Item } from '../../models/Item';
import { User } from '../../models/User';
import { ITEMS_ROUTES } from '../../routes/routes.constant';
import { PERMISSIONS } from '../../constants/permissions.constant';
import { loginAndGetTokens, TEST_USER } from '../helpers';
import { createItemSchema } from '../../schemas/item.schema';

describe('power-of-two storage', () => {
	it('accepts powers of two, nullable unknown storage and fractional terabytes', () => {
		for (const depolama of [null, 1, 8, 16, 1024, 0.25]) expect(createItemSchema.safeParse({ model: 'OK', depolama }).success).toBe(true);
		for (const depolama of [0, -8, 55, 1843.2, Infinity, NaN]) expect(createItemSchema.safeParse({ model: 'BAD', depolama }).success).toBe(false);
	});
	it('rejects invalid create, single update and bulk update requests with a clear message', async () => {
		await User.updateOne({ email: TEST_USER.email }, { $set: { permissions: [PERMISSIONS.ITEMS_CREATE, PERMISSIONS.ITEMS_UPDATE] } });
		const item = await Item.create({ model: 'EXISTING', depolama: 64 });
		const { accessToken } = await loginAndGetTokens();
		const auth = `Bearer ${accessToken}`;
		const responses = [
			await request(app).post(ITEMS_ROUTES.CREATE).set('Authorization', auth).send({ model: 'BAD', depolama: 55 }),
			await request(app).patch(`/items/${item._id}`).set('Authorization', auth).send({ depolama: 55 }),
			await request(app).patch(ITEMS_ROUTES.BULK_UPDATE).set('Authorization', auth).send({ ids: [String(item._id)], fields: { depolama: 55 } }),
		];
		for (const response of responses) {
			expect(response.status).toBe(400);
			expect(response.body.message).toContain('2’nin kuvveti');
		}
		expect((await Item.findById(item._id))?.depolama).toBe(64);
		expect(await Item.countDocuments({ model: 'BAD' })).toBe(0);
	});
	it('enforces the same constraint in Mongoose for direct inserts', async () => {
		await expect(new Item({ model: 'DIRECT', depolama: 55 }).validate()).rejects.toThrow('2’nin kuvveti');
	});
});
