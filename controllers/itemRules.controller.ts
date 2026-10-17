import type { Request, Response } from 'express';
import { nanoid } from 'nanoid';
import { ItemRuleSet, ITEM_RULE_SET_ID } from '../models/ItemRuleSet';
import { User } from '../models/User';
import { ADMIN_ROLES, PERMISSIONS, type Permission } from '../constants/permissions.constant';
import { LOG_ENTITY_TYPES } from '../models/LogEvent';
import { requireUserId } from './auth.helper';
import { ConflictError, ForbiddenError, UnauthorizedError } from '../errors/HttpError';
import { handleHttpError } from '../errors/handleHttpError';
import { recordLogEvent } from '../services/logEvents/recordLogEvent.service';
import type { SaveItemRulesInput, ItemRuleData } from '../schemas/itemRule.schema';
import logger from '../util/logger';

async function actor(req: Request) {
	const user = await User.findById(requireUserId(req)).select('username role permissions').lean();
	if (!user) throw new UnauthorizedError();
	return user;
}

export async function listItemRules(req: Request, res: Response): Promise<void> {
	const log = logger.child({ method: 'listItemRules' });
	try {
		await actor(req);
		const saved = await ItemRuleSet.findById(ITEM_RULE_SET_ID).lean();
		res.set('Cache-Control', 'no-store');
		res.json({ success: true, rules: saved?.rules ?? [], revision: saved?.revision ?? 0 });
	} catch (error) { handleHttpError(error, res, log); }
}

/** Saves one ordered snapshot atomically. Permissions are checked for the
 * actual additions, edits, reorderings and removals in that snapshot.
 */
export async function saveItemRules(req: Request, res: Response): Promise<void> {
	const log = logger.child({ method: 'saveItemRules' });
	try {
		const admin = await actor(req);
		const { rules, revision }: SaveItemRulesInput = req.body;
		const saved = await ItemRuleSet.findById(ITEM_RULE_SET_ID).lean();
		if ((saved?.revision ?? 0) !== revision) throw new ConflictError('Kurallar başka bir oturumda değişti. Listeyi yenileyip tekrar deneyin.');
		const previous = saved?.rules ?? [];
		const oldById = new Map(previous.map((rule) => [rule.id, rule]));
		const nextById = new Map(rules.map((rule) => [rule.id, rule]));
		const added = rules.filter((rule) => !oldById.has(rule.id));
		const removed = previous.filter((rule) => !nextById.has(rule.id));
		const changed = rules.filter((rule) => oldById.has(rule.id) && JSON.stringify(rule) !== JSON.stringify(oldById.get(rule.id)));
		const oldOrder = previous.filter((rule) => nextById.has(rule.id)).map((rule) => rule.id);
		const newOrder = rules.filter((rule) => oldById.has(rule.id)).map((rule) => rule.id);
		const reordered = JSON.stringify(oldOrder) !== JSON.stringify(newOrder);
		const required: Permission[] = [];
		if (added.length) required.push(PERMISSIONS.ITEMS_ADD_RULE);
		if (removed.length) required.push(PERMISSIONS.ITEMS_DELETE_RULE);
		if (changed.length || reordered) required.push(PERMISSIONS.ITEMS_EDIT_RULE);
		if (admin.role !== ADMIN_ROLES.HEAD_ADMIN && required.some((permission) => !admin.permissions.includes(permission))) throw new ForbiddenError();
		if (!required.length) { res.json({ success: true, rules: previous, revision }); return; }
		try {
			if (!saved) await ItemRuleSet.create({ _id: ITEM_RULE_SET_ID, rules, revision: 1 });
			else {
				const result = await ItemRuleSet.updateOne({ _id: ITEM_RULE_SET_ID, revision }, { $set: { rules }, $inc: { revision: 1 } });
				if (!result.matchedCount) throw new ConflictError('Kurallar değişti. Listeyi yenileyip tekrar deneyin.');
			}
		} catch (error) {
			if ((error as { code?: number }).code === 11000) throw new ConflictError('Kurallar değişti. Listeyi yenileyip tekrar deneyin.');
			throw error;
		}
		const batchId = nanoid();
		const logRule = (rule: ItemRuleData, action: Permission, before: ItemRuleData | null, after: ItemRuleData | null) => recordLogEvent({
			adminId: String(admin._id), adminUsername: admin.username, action,
			entityType: LOG_ENTITY_TYPES.ITEM_RULE, entityId: null, entityKey: rule.name, batchId,
			fields: [{ field: 'rule', previousValue: before ? JSON.stringify(before) : null, newValue: after ? JSON.stringify(after) : null }],
		});
		await Promise.all([
			...added.map((rule) => logRule(rule, PERMISSIONS.ITEMS_ADD_RULE, null, rule)),
			...removed.map((rule) => logRule(rule, PERMISSIONS.ITEMS_DELETE_RULE, rule, null)),
			...changed.map((rule) => logRule(rule, PERMISSIONS.ITEMS_EDIT_RULE, oldById.get(rule.id)!, rule)),
			...(reordered ? [recordLogEvent({ adminId: String(admin._id), adminUsername: admin.username, action: PERMISSIONS.ITEMS_EDIT_RULE, entityType: LOG_ENTITY_TYPES.ITEM_RULE, entityId: null, entityKey: 'Kural önceliği', batchId, fields: [{ field: 'order', previousValue: JSON.stringify(oldOrder), newValue: JSON.stringify(newOrder) }] })] : []),
		]);
		res.json({ success: true, rules, revision: revision + 1 });
	} catch (error) { handleHttpError(error, res, log); }
}
