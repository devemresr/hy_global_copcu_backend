import type { Request, Response } from 'express';
import { nanoid } from 'nanoid';
import { Item } from '../models/Item';
import { LOG_ACTIONS, LOG_ENTITY_TYPES } from '../models/LogEvent';
import type { FieldChange } from '../models/LogEvent';
import {
	EDITABLE_ITEM_FIELDS,
	type CreateItemInput,
	type UpdateItemInput,
	type BulkUpdateItemsInput,
} from '../schemas/item.schema';
import { recordLogEvent } from '../services/logEvents/recordLogEvent.service';
import { createCachedFetcher } from '../util/queryCache';
import {
	getVersion,
	withVersionBump,
} from '../services/sync/version.service';
import { requireUserId } from './auth.helper';
import { UnauthorizedError, NotFoundError } from '../errors/HttpError';
import { handleHttpError } from '../errors/handleHttpError';
import logger from '../util/logger';

// Same 5 min TTL as queryCache's own usage example - the admin list is read
// often but changes rarely, and every write below invalidates immediately
// anyway, so a longer window never serves stale data past an edit.
const ITEMS_TTL_MS = 5 * 60 * 1000;

const itemsCache = createCachedFetcher(
	() => Item.find({ deletedAt: null }).select('-deletedAt -__v').lean(),
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
		res.set('Cache-Control', 'no-cache');
		res.set('ETag', `"items-${version}"`);
		if (req.fresh) {
			log.debug({ version }, 'Not modified');
			res.status(304).end();
			return;
		}

		const items = await itemsCache.get();
		log.debug({ version, count: items.length }, 'Items listed');
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
			const items = await itemsCache.get();
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

		log.debug(
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

// BulkEditPanel used to fire one PATCH per matched row (Promise.allSettled
// client-side) - same end result, but N round trips and N separate write
// commands instead of one. Every matched id gets the exact same `fields`
// here, so a single updateMany's one filter/one $set covers it; bulkWrite is
// the right call only when different documents need different updates in
// one round trip, which isn't the case for "set this field to this value on
// every matched row".
export const bulkUpdateItems = async (
	req: Request,
	res: Response,
): Promise<void> => {
	const log = logger.child({ method: 'bulkUpdateItems' });
	try {
		const actor = requireLogActor(req);
		const { ids, fields }: BulkUpdateItemsInput = req.body;
		log.debug({ adminId: actor.adminId, ids, fields }, 'Bulk updating items');

		const previousItems = await Item.find({
			_id: { $in: ids },
			deletedAt: null,
		}).lean();

		// The whole batch shares one version.
		const { result, version } = await withVersionBump(async (version) => {
			const result = await Item.updateMany(
				{ _id: { $in: ids }, deletedAt: null },
				{ $set: { ...fields, version } },
				{ runValidators: true },
			);
			itemsCache.invalidate();
			return { result, version };
		});

		// One id shared by every row this request touches, so listLogEvents can
		// fold them back into the single bulk event they came from instead of
		// paginating over N indistinguishable per-row entries (see LogEvent
		// model's own comment on batchId).
		const batchId = nanoid();
		const changedFieldKeys = Object.keys(fields) as (keyof UpdateItemInput)[];
		await Promise.all(
			previousItems.map((previous) => {
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
