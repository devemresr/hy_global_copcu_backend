import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../app';
import { User } from '../../models/User';
import { ItemRuleSet } from '../../models/ItemRuleSet';
import { LogEvent } from '../../models/LogEvent';
import { PERMISSIONS, type Permission } from '../../constants/permissions.constant';
import { loginAndGetTokens, TEST_USER } from '../helpers';
import { itemRuleSchema, type ItemRuleData } from '../../schemas/itemRule.schema';
import { Item } from '../../models/Item';
import { getVersion } from '../../services/sync/version.service';

const rule: ItemRuleData = { id: 'pa-price', name: 'PA fiyatı', enabled: true, conditions: [{ field: 'model', op: 'contains', value: 'pa' }], actions: [{ field: 'fiyat', value: '150' }] };
async function auth(permissions: Permission[]) {
	await User.updateOne({ email: TEST_USER.email }, { $set: { permissions } });
	return `Bearer ${(await loginAndGetTokens()).accessToken}`;
}

describe('server item rules', () => {
	it('publishes only per-item price classifications while keeping rule administration private', async () => {
		await ItemRuleSet.create({ _id: 'creation', revision: 2, rules: [rule, { ...rule, id: 'disabled', enabled: false, conditions: [{ field: 'model', op: 'equals', value: 'OTHER' }] }] });
		await Item.create([{ model: 'PA123', fiyat: 150 }, { model: 'OTHER', fiyat: 300 }, { model: 'PA_DELETED', fiyat: 150, deletedAt: new Date() }]);
		const response = await request(app).get('/items/price-rules');
		expect(response.status).toBe(200);
		expect(response.body.revision).toBe(2);
		expect(response.body.assignments).toHaveLength(1);
		expect(response.body.assignments[0]).toMatchObject({ ruleId: rule.id, ruleName: rule.name, rulePrice: 150 });
		expect(Object.keys(response.body.assignments[0]).sort()).toEqual(['key', 'ruleId', 'ruleName', 'rulePrice']);
		expect(JSON.parse(response.body.assignments[0].key)[0]).toBe('PA123');
		expect((await request(app).get('/item-rules')).status).toBe(401);
	});
	it('accepts notContains for text fields only', () => {
		expect(itemRuleSchema.safeParse({ ...rule, conditions: [{ field: 'model', op: 'notContains', value: 'pa' }] }).success).toBe(true);
		expect(itemRuleSchema.safeParse({ ...rule, conditions: [{ field: 'fiyat', op: 'notContains', value: 'pa' }] }).success).toBe(false);
	});
	it('blocks conflicting bulk changes until approved and audits the requested values in one batch', async () => {
		await ItemRuleSet.create({ _id: 'creation', revision: 1, rules: [
			rule,
			{ ...rule, id: 'lower', actions: [{ field: 'fiyat', value: '200' }, { field: 'bellekTipi', value: 'eMMC' }] },
			{ ...rule, id: 'opposite', conditions: [{ field: 'model', op: 'notContains', value: 'pa' }], actions: [{ field: 'fiyat', value: '75' }] },
			{ ...rule, id: 'disabled', enabled: false, actions: [{ field: 'paraBirimi', value: 'USD' }] },
		] });
		const [first, second, untouched, deleted] = await Item.create([
			{ model: 'PA123', fiyat: 10 }, { model: 'OTHER', fiyat: 20 }, { model: 'PA_UNTOUCHED', fiyat: 30 }, { model: 'PA_DELETED', fiyat: 40, deletedAt: new Date() },
		]);
		const token = await auth([PERMISSIONS.ITEMS_UPDATE]);
		const before = getVersion();
		const body = { ids: [String(first._id), String(second._id), String(deleted._id)], fields: { fiyat: 99 } };
		const blocked = await request(app).patch('/items/bulk').set('Authorization', token).send(body);
		expect(blocked.status).toBe(409);
		expect((await Item.findById(first._id))!.fiyat).toBe(10);
		expect((await Item.findById(second._id))!.fiyat).toBe(20);
		// The sync counter advances for every attempted write, including failures.
		expect(getVersion()).toBe(before + 1);
		expect(await LogEvent.countDocuments({ entityType: 'item' })).toBe(0);
		const stale = await request(app).patch('/items/bulk').set('Authorization', token).send({ ...body, ruleOverrideRevision: 0 });
		expect(stale.status).toBe(409);
		expect(getVersion()).toBe(before + 2);
		expect((await Item.findById(first._id))!.fiyat).toBe(10);
		expect((await Item.findById(second._id))!.fiyat).toBe(20);
		expect(await LogEvent.countDocuments({ entityType: 'item' })).toBe(0);
		const response = await request(app).patch('/items/bulk').set('Authorization', token).send({ ...body, ruleOverrideRevision: 1 });
		expect(response.status).toBe(200);
		expect(response.body).toMatchObject({ matchedCount: 2, modifiedCount: 2 });
		const approvedVersion = before + 3;
		expect(getVersion()).toBe(approvedVersion);
		expect(await Item.findById(first._id).lean()).toMatchObject({ fiyat: 99, paraBirimi: 'TRY', version: approvedVersion });
		expect((await Item.findById(first._id))!.bellekTipi).toBeUndefined();
		expect(await Item.findById(second._id).lean()).toMatchObject({ fiyat: 99, version: approvedVersion });
		expect((await Item.findById(untouched._id))!.fiyat).toBe(30);
		expect((await Item.findById(deleted._id))!.fiyat).toBe(40);
		const logs = await LogEvent.find({ entityType: 'item' }).lean();
		expect(logs).toHaveLength(2);
		expect(logs.every((entry) => entry.version === approvedVersion)).toBe(true);
		expect(new Set(logs.map((entry) => entry.batchId)).size).toBe(1);
		expect(logs.find((entry) => entry.entityKey === 'PA123')!.fields).toContainEqual({ field: 'fiyat', previousValue: 10, newValue: 99 });
		expect((await ItemRuleSet.findById('creation'))!.rules[0].actions[0].value).toBe('150');
	});
	it('matches rules against post-edit fields and leaves unmatched bulk values intact', async () => {
		await ItemRuleSet.create({ _id: 'creation', revision: 1, rules: [rule] });
		const item = await Item.create({ model: 'OTHER', fiyat: 10 });
		const token = await auth([PERMISSIONS.ITEMS_UPDATE]);
		const edit = (fields: Record<string, unknown>) => request(app).patch('/items/bulk').set('Authorization', token).send({ ids: [String(item._id)], fields });
		expect((await edit({ model: 'PA_NEW', fiyat: 99 })).status).toBe(409);
		expect((await edit({ model: 'PA_NEW', fiyat: 150 })).status).toBe(200);
		expect((await Item.findById(item._id))!.fiyat).toBe(150);
		expect((await edit({ model: 'OTHER', fiyat: 99 })).status).toBe(200);
		expect((await Item.findById(item._id))!.fiyat).toBe(99);
	});
	it('does not apply unrelated rule actions or warn for disabled rules', async () => {
		await ItemRuleSet.create({ _id: 'creation', revision: 1, rules: [rule] });
		const item = await Item.create({ model: 'PA123', fiyat: 150 });
		const token = await auth([PERMISSIONS.ITEMS_UPDATE]);
		const send = (fields: Record<string, unknown>) => request(app).patch('/items/bulk').set('Authorization', token).send({ ids: [String(item._id)], fields });
		expect((await send({ bellekTipi: 'eMMC' })).status).toBe(200);
		expect((await Item.findById(item._id))!.fiyat).toBe(150);
		await ItemRuleSet.updateOne({ _id: 'creation' }, { $set: { 'rules.0.enabled': false } });
		expect((await send({ fiyat: 200 })).status).toBe(200);
		expect((await Item.findById(item._id))!.fiyat).toBe(200);
	});
	it('accepts model-length conditions and rejects them for other fields or invalid lengths', () => {
		const withLength = (field: string, value: string) => ({ ...rule, conditions: [{ field, op: 'lengthEquals', value }] });
		expect(itemRuleSchema.safeParse(withLength('model', '3')).success).toBe(true);
		expect(itemRuleSchema.safeParse(withLength('bellekTipi', '3')).success).toBe(false);
		for (const value of ['', '-1', '1.5', 'abc']) expect(itemRuleSchema.safeParse(withLength('model', value)).success).toBe(false);
	});
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
