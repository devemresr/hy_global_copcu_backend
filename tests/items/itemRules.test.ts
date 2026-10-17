import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../app';
import { User } from '../../models/User';
import { ItemRuleSet } from '../../models/ItemRuleSet';
import { LogEvent } from '../../models/LogEvent';
import { PERMISSIONS, type Permission } from '../../constants/permissions.constant';
import { loginAndGetTokens, TEST_USER } from '../helpers';

const rule = { id: 'pa-price', name: 'PA fiyatı', enabled: true, conditions: [{ field: 'model', op: 'contains', value: 'pa' }], actions: [{ field: 'fiyat', value: '150' }] };
async function auth(permissions: Permission[]) {
	await User.updateOne({ email: TEST_USER.email }, { $set: { permissions } });
	return `Bearer ${(await loginAndGetTokens()).accessToken}`;
}

describe('server item rules', () => {
	it('persists, edits, reorders and deletes rules, with audit records and revision checks', async () => {
		const token = await auth([PERMISSIONS.ITEMS_ADD_RULE, PERMISSIONS.ITEMS_EDIT_RULE, PERMISSIONS.ITEMS_DELETE_RULE]);
		const initial = await request(app).get('/item-rules').set('Authorization', token);
		expect(initial.body).toMatchObject({ rules: [], revision: 0 });
		const added = await request(app).put('/item-rules').set('Authorization', token).send({ rules: [rule], revision: 0 });
		expect(added.status).toBe(200); expect(added.body.revision).toBe(1);
		const edited = { ...rule, enabled: false };
		expect((await request(app).put('/item-rules').set('Authorization', token).send({ rules: [edited], revision: 1 })).body.revision).toBe(2);
		const stale = await request(app).put('/item-rules').set('Authorization', token).send({ rules: [], revision: 1 });
		expect(stale.status).toBe(409);
		const second = { ...rule, id: 'second', name: 'Second' };
		expect((await request(app).put('/item-rules').set('Authorization', token).send({ rules: [edited, second], revision: 2 })).body.revision).toBe(3);
		expect((await request(app).put('/item-rules').set('Authorization', token).send({ rules: [second, edited], revision: 3 })).body.revision).toBe(4);
		const listed = await request(app).get('/item-rules').set('Authorization', token);
		expect(listed.body.rules.map((entry: { id: string }) => entry.id)).toEqual(['second', rule.id]);
		expect((await request(app).put('/item-rules').set('Authorization', token).send({ rules: [], revision: 4 })).body.revision).toBe(5);
		const logs = await LogEvent.find({ entityType: 'item_rule' }).lean();
		expect(logs.some((entry) => entry.action === PERMISSIONS.ITEMS_ADD_RULE)).toBe(true);
		expect(logs.some((entry) => entry.action === PERMISSIONS.ITEMS_EDIT_RULE)).toBe(true);
		expect(logs.some((entry) => entry.action === PERMISSIONS.ITEMS_DELETE_RULE)).toBe(true);
	});
	it('enforces the permissions required by each change and rejects unauthenticated reads', async () => {
		expect((await request(app).get('/item-rules')).status).toBe(401);
		const token = await auth([PERMISSIONS.ITEMS_ADD_RULE]);
		expect((await request(app).put('/item-rules').set('Authorization', token).send({ rules: [rule], revision: 0 })).status).toBe(200);
		expect((await request(app).put('/item-rules').set('Authorization', token).send({ rules: [{ ...rule, enabled: false }], revision: 1 })).status).toBe(403);
		expect((await request(app).put('/item-rules').set('Authorization', token).send({ rules: [], revision: 1 })).status).toBe(403);
	});
	it('rejects invalid filters, duplicate ids and invalid storage defaults atomically', async () => {
		const token = await auth([PERMISSIONS.ITEMS_ADD_RULE]);
		const invalid = [
			[rule, rule],
			[{ ...rule, conditions: [] }],
			[{ ...rule, conditions: [{ field: 'model', op: 'gte', value: '5' }] }],
			[{ ...rule, actions: [{ field: 'depolama', value: '55' }] }],
		];
		for (const rules of invalid) expect((await request(app).put('/item-rules').set('Authorization', token).send({ rules, revision: 0 })).status).toBe(400);
		expect(await ItemRuleSet.countDocuments()).toBe(0);
	});
});
