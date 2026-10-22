import type { Request, Response } from 'express';
import { nanoid } from 'nanoid';
import { createHash } from 'node:crypto';
import { Item } from '../models/Item';
import { ItemRuleSet, ITEM_RULE_SET_ID } from '../models/ItemRuleSet';
import { resolveBulkItemRules } from '../services/items/resolveItemRules';
import { LOG_ACTIONS, LOG_ENTITY_TYPES } from '../models/LogEvent';
import type { FieldChange } from '../models/LogEvent';
import {
	EDITABLE_ITEM_FIELDS,
	type CreateItemInput,
	type UpdateItemInput,
	type BulkUpdateItemsInput,
	type BulkDeleteItemsInput,
} from '../schemas/item.schema';
import { recordLogEvent } from '../services/logEvents/recordLogEvent.service';
import { createCachedFetcher } from '../util/queryCache';
import {
	getVersion,
	withVersionBump,
} from '../services/sync/version.service';
import { requireUserId } from './auth.helper';
import { UnauthorizedError, NotFoundError, ConflictError } from '../errors/HttpError';
import { handleHttpError } from '../errors/handleHttpError';
import logger from '../util/logger';

// Same 5 min TTL as queryCache's own usage example - the admin list is read
// often but changes rarely, and every write below invalidates immediately
// anyway, so a longer window never serves stale data past an edit.
const ITEMS_TTL_MS = 5 * 60 * 1000;

const itemsCache = createCachedFetcher(
	async () => {
		const items = await Item.find({ deletedAt: null }).select('-deletedAt -__v').sort({ _id: 1 }).lean();
		return { items, fingerprint: createHash('sha256').update(JSON.stringify(items)).digest('hex') };
	},
	{ ttlMs: ITEMS_TTL_MS },
);

// requirePermission/requireHeadAdmin always run before a mutating route
// below and set both, so this narrows the optional Request fields once
// instead of at every call site.
function requireLogActor(req: Request): {
	adminId: string;
	adminUsername: string;
} {
	const adminId = requireUserId(req);
	if (!req.adminUsername) {
		throw new UnauthorizedError(
			'adminUsername missing from request - authorize middleware did not run',
		);
	}
	return { adminId, adminUsername: req.adminUsername };
}

// The version is read before the items, so the list is never older than the
// version it's labelled with (an in-flight write can only make it newer).
export const listItems = async (
	req: Request,
	res: Response,
): Promise<void> => {
	const log = logger.child({ method: 'listItems' });
	try {
		const version = getVersion();
		const { value: { items, fingerprint }, source, cachedAt, expiresAt } = await itemsCache.getWithMetadata();
		const cacheDetails = { source, cachedAt: cachedAt ? new Date(cachedAt).toISOString() : null, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null, cacheAgeMs: cachedAt ? Date.now() - cachedAt : null };
		res.set('Cache-Control', 'no-cache');
		// A seed can reset version to zero. Data identity must also participate
		// so an old empty response cannot validate against a populated database.
		res.set('ETag', `"items-${version}-${fingerprint}"`);
		if (items.length === 0) {
			itemsCache.invalidate();
			log.warn({ version, ...cacheDetails, database: Item.db.name, collection: Item.collection.name }, 'Items query returned no active items; empty result will not be retained in cache');
		}
		if (req.fresh) {
			log.info({ version, count: items.length, ...cacheDetails, responseSource: 'browser-http-cache' }, 'Items HTTP cache revalidated (304)');
			res.status(304).end();
			return;
		}

		log.info({ version, count: items.length, ...cacheDetails, database: Item.db.name, collection: Item.collection.name }, 'Items served (200)');
		res.status(200).json({ success: true, version, items });
	} catch (error) {
		handleHttpError(error, res, log);
	}
};

/**
 * GET /items/changes?since=N - everything written after version N. A `since`
 * that's missing, invalid, or ahead of the server (the DB was reset) gets
 * the full list back with `full: true` so the client replaces its copy.
 */
export const listItemChanges = async (
	req: Request,
	res: Response,
): Promise<void> => {
	const log = logger.child({ method: 'listItemChanges' });
	try {
		const version = getVersion();
		const since = Number(req.query.since);
		res.set('Cache-Control', 'no-store');

		if (!Number.isInteger(since) || since < 0 || since > version) {
			log.debug({ since, version }, 'since missing/invalid/ahead, returning full list');
			const { value: { items }, source, cachedAt, expiresAt } = await itemsCache.getWithMetadata();
			if (items.length === 0) itemsCache.invalidate();
			log.info({ since, version, count: items.length, source, cachedAt, expiresAt }, 'Full items list served for delta reset');
			res.status(200).json({ success: true, full: true, version, items });
			return;
		}

		const changed = await Item.find({ version: { $gt: since } })
			.select('-__v')
			.lean();
		const updated = changed
			.filter((item) => !item.deletedAt)
			.map(({ deletedAt: _deletedAt, ...item }) => item);
		const deleted = changed
			.filter((item) => item.deletedAt)
			.map((item) => item._id.toString());

		log.info(
			{ since, version, updated: updated.length, deleted: deleted.length },
			'Item changes listed',
		);
		res.status(200).json({ success: true, full: false, version, updated, deleted });
	} catch (error) {
		handleHttpError(error, res, log);
	}
};

export const createItem = async (
	req: Request,
	res: Response,
): Promise<void> => {
	const log = logger.child({ method: 'createItem' });
	try {
		const actor = requireLogActor(req);
		const fields: CreateItemInput = req.body;
		log.debug({ adminId: actor.adminId, model: fields.model }, 'Creating item');

		const item = await withVersionBump(async (version) => {
			const created = await Item.create({ ...fields, version });
			itemsCache.invalidate();
			return created;
		});

		const changedFields: FieldChange[] = EDITABLE_ITEM_FIELDS.map((field) => ({
			field,
			previousValue: null,
			newValue: item[field] ?? null,
		}));
		await recordLogEvent({
			...actor,
			action: LOG_ACTIONS.ITEMS_CREATE,
			entityType: LOG_ENTITY_TYPES.ITEM,
			entityId: item._id.toString(),
			entityKey: item.model,
			fields: changedFields,
			version: item.version,
		});

		log.info(
			{ adminId: actor.adminId, itemId: item._id.toString(), model: item.model },
			'Item created',
		);
		res.status(201).json({ success: true, item: item.toObject() });
	} catch (error) {
		handleHttpError(error, res, log);
	}
};

export const updateItem = async (
	req: Request,
	res: Response,
): Promise<void> => {
	const { id } = req.params;
	const log = logger.child({ method: 'updateItem', itemId: id });

	try {
		const actor = requireLogActor(req);
		const update: UpdateItemInput = req.body;
		log.debug({ adminId: actor.adminId, update }, 'Updating item');

		const previous = await Item.findOne({ _id: id, deletedAt: null }).lean();
		if (!previous) {
			log.warn('Item not found');
			throw new NotFoundError('Item');
		}

		const item = await withVersionBump(async (version) => {
			const updated = await Item.findOneAndUpdate(
				{ _id: id, deletedAt: null },
				{ ...update, version },
				{ new: true, runValidators: true },
			)
				.select('-deletedAt -__v')
				.lean();
			// Guaranteed-fresh next read beats staying inside the TTL window.
			itemsCache.invalidate();
			return updated;
		});

		if (!item) {
			log.warn('Item not found after update');
			throw new NotFoundError('Item');
		}

		// update only ever has keys that were actually sent (see updateItemSchema's
		// .partial() - an omitted field is absent here, not present-as-undefined).
		const changedFields: FieldChange[] = (
			Object.keys(update) as (keyof UpdateItemInput)[]
		)
			.filter((field) => update[field] !== (previous[field] ?? null))
			.map((field) => ({
				field,
				previousValue: previous[field] ?? null,
				newValue: update[field] ?? null,
			}));
		if (changedFields.length > 0) {
			await recordLogEvent({
				...actor,
				action: LOG_ACTIONS.ITEMS_UPDATE,
				entityType: LOG_ENTITY_TYPES.ITEM,
				entityId: item._id.toString(),
				entityKey: item.model,
				fields: changedFields,
				version: item.version,
			});
			log.info(
				{ adminId: actor.adminId, changedFields: changedFields.map((f) => f.field) },
				'Item updated',
			);
		} else {
			log.debug('No fields actually changed');
		}

		res.status(200).json({ success: true, item });
	} catch (error) {
		handleHttpError(error, res, log);
	}
};

// Rule conflicts require explicit approval before any row in the batch changes.
export const bulkUpdateItems = async (
	req: Request,
	res: Response,
): Promise<void> => {
	const log = logger.child({ method: 'bulkUpdateItems' });
	try {
		const actor = requireLogActor(req);
		const { ids, fields, ruleOverrideRevision }: BulkUpdateItemsInput = req.body;
		log.debug({ adminId: actor.adminId, ids, fields }, 'Bulk updating items');

		const { result, version, updates } = await withVersionBump(async (version) => {
			const previousItems = await Item.find({ _id: { $in: ids }, deletedAt: null }).lean();
			const ruleSet = await ItemRuleSet.findById(ITEM_RULE_SET_ID).lean();
			const hasConflicts = previousItems.some((previous) => {
				const resolved = resolveBulkItemRules(previous, fields, ruleSet?.rules ?? []);
				return (Object.keys(fields) as (keyof UpdateItemInput)[]).some((field) => resolved[field] !== fields[field]);
			});
			if (hasConflicts && ruleOverrideRevision !== (ruleSet?.revision ?? 0)) {
				throw new ConflictError('Bu değişiklik ürün kurallarıyla çelişiyor. Kuralları yenileyip kural uyarısını onaylayın.');
			}
			// Approval saves the requested fields exactly; rules remain unchanged.
			const updates = previousItems.map((previous) => ({ previous, fields }));
			const result = updates.length ? await Item.bulkWrite(updates.map(({ previous, fields: resolved }) => ({
				updateOne: { filter: { _id: previous._id, deletedAt: null }, update: { $set: { ...resolved, version } } },
			}))) : { matchedCount: 0, modifiedCount: 0 };
			itemsCache.invalidate();
			return { result, version, updates };
		});

		// One id shared by every row this request touches, so listLogEvents can
		// fold them back into the single bulk event they came from instead of
		// paginating over N indistinguishable per-row entries (see LogEvent
		// model's own comment on batchId).
		const batchId = nanoid();
		await Promise.all(
			updates.map(({ previous, fields }) => {
				const changedFieldKeys = Object.keys(fields) as (keyof UpdateItemInput)[];
				const changedFields: FieldChange[] = changedFieldKeys
					.filter((field) => fields[field] !== (previous[field] ?? null))
					.map((field) => ({
						field,
						previousValue: previous[field] ?? null,
						newValue: fields[field] ?? null,
					}));
				if (changedFields.length === 0) return Promise.resolve();
				return recordLogEvent({
					...actor,
					action: LOG_ACTIONS.ITEMS_UPDATE,
					entityType: LOG_ENTITY_TYPES.ITEM,
					entityId: previous._id.toString(),
					entityKey: previous.model,
					fields: changedFields,
					batchId,
					version,
				});
			}),
		);

		if (result.matchedCount === 0) {
			// Most often stale ids: the client's list was captured before a
			// delete/reseed, so none of the selected rows exist anymore.
			log.warn(
				{ adminId: actor.adminId, ids },
				'Bulk update matched no items - ids are likely stale',
			);
		} else {
			log.info(
				{
					adminId: actor.adminId,
					matchedCount: result.matchedCount,
					modifiedCount: result.modifiedCount,
				},
				'Items bulk updated',
			);
		}

		res.status(200).json({
			success: true,
			matchedCount: result.matchedCount,
			modifiedCount: result.modifiedCount,
		});
	} catch (error) {
		handleHttpError(error, res, log);
	}
};

/** Same soft-delete, version and audit behavior as deleteItem, one batch. */
export const bulkDeleteItems = async (req: Request, res: Response): Promise<void> => {
	const log = logger.child({ method: 'bulkDeleteItems' });
	try {
		const actor = requireLogActor(req);
		const { ids }: BulkDeleteItemsInput = req.body;
		const { deletedItems, version } = await withVersionBump(async (version) => {
			// Read inside the write queue so concurrent server mutations cannot
			// change the snapshot between selection and deletion.
			const previousItems = await Item.find({ _id: { $in: ids }, deletedAt: null }).lean();
			if (!previousItems.length) return { deletedItems: previousItems, version };
			const selectedIds = previousItems.map((item) => item._id);
			const deletedAt = new Date();
			await Item.updateMany(
				{ _id: { $in: selectedIds }, deletedAt: null },
				{ $set: { deletedAt, version } },
			);
			itemsCache.invalidate();
			// Only log rows actually changed by this request, including when an
			// external process has already deleted one of the selected rows.
			const changed = await Item.find({ _id: { $in: selectedIds }, deletedAt, version }).select('_id').lean();
			const changedIds = new Set(changed.map((item) => item._id.toString()));
			return { deletedItems: previousItems.filter((item) => changedIds.has(item._id.toString())), version };
		});
		const batchId = nanoid();
		await Promise.all(deletedItems.map((item) => recordLogEvent({
			...actor,
			action: LOG_ACTIONS.ITEMS_DELETE,
			entityType: LOG_ENTITY_TYPES.ITEM,
			entityId: item._id.toString(),
			entityKey: item.model,
			fields: EDITABLE_ITEM_FIELDS.map((field) => ({ field, previousValue: item[field] ?? null, newValue: null })),
			batchId,
			version,
		})));
		log.info({ adminId: actor.adminId, requestedCount: ids.length, deletedCount: deletedItems.length, batchId }, 'Items bulk deleted');
		res.status(200).json({ success: true, matchedCount: deletedItems.length, deletedCount: deletedItems.length, deletedIds: deletedItems.map((item) => String(item._id)), version });
	} catch (error) {
		handleHttpError(error, res, log);
	}
};

export const deleteItem = async (
	req: Request,
	res: Response,
): Promise<void> => {
	const { id } = req.params;
	const log = logger.child({ method: 'deleteItem', itemId: id });

	try {
		const actor = requireLogActor(req);
		log.debug({ adminId: actor.adminId }, 'Deleting item');

		const { item, version } = await withVersionBump(async (version) => {
			const item = await Item.findOneAndUpdate(
				{ _id: id, deletedAt: null },
				{ $set: { deletedAt: new Date(), version } },
			).lean();
			itemsCache.invalidate();
			return { item, version };
		});

		if (!item) {
			log.warn('Item not found');
			throw new NotFoundError('Item');
		}

		const changedFields: FieldChange[] = EDITABLE_ITEM_FIELDS.map((field) => ({
			field,
			previousValue: item[field] ?? null,
			newValue: null,
		}));
		await recordLogEvent({
			...actor,
			action: LOG_ACTIONS.ITEMS_DELETE,
			entityType: LOG_ENTITY_TYPES.ITEM,
			entityId: item._id.toString(),
			entityKey: item.model,
			fields: changedFields,
			version,
		});

		log.info({ adminId: actor.adminId, model: item.model }, 'Item deleted');
		res.status(200).json({ success: true });
	} catch (error) {
		handleHttpError(error, res, log);
	}
};
