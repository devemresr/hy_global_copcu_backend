import type { Request, Response } from 'express';
import { Item } from '../models/Item';
import { LOG_ACTIONS, LOG_ENTITY_TYPES } from '../models/LogEvent';
import type { FieldChange } from '../models/LogEvent';
import {
	EDITABLE_ITEM_FIELDS,
	type CreateItemInput,
	type UpdateItemInput,
} from '../schemas/item.schema';
import { recordLogEvent } from '../services/logEvents/recordLogEvent.service';
import { createCachedFetcher } from '../util/queryCache';
import { requireUserId } from './auth.helper';
import { UnauthorizedError, NotFoundError } from '../errors/HttpError';
import { handleHttpError } from '../errors/handleHttpError';
import logger from '../util/logger';

const log = logger.child({ controller: 'items' });

// Same 5 min TTL as queryCache's own usage example - the admin list is read
// often but changes rarely, and every write below invalidates immediately
// anyway, so a longer window never serves stale data past an edit.
const ITEMS_TTL_MS = 5 * 60 * 1000;

const itemsCache = createCachedFetcher(() => Item.find().lean(), {
	ttlMs: ITEMS_TTL_MS,
});

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

export const listItems = async (
	_req: Request,
	res: Response,
): Promise<void> => {
	try {
		const items = await itemsCache.get();
		res.status(200).json({ success: true, items });
	} catch (error) {
		handleHttpError(error, res, log);
	}
};

export const createItem = async (
	req: Request,
	res: Response,
): Promise<void> => {
	try {
		const actor = requireLogActor(req);
		const fields: CreateItemInput = req.body;

		const item = await Item.create(fields);
		itemsCache.invalidate();

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
		});

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
	const scopedLog = log.child({ itemId: id });

	try {
		const actor = requireLogActor(req);
		const update: UpdateItemInput = req.body;

		const previous = await Item.findById(id).lean();
		if (!previous) {
			throw new NotFoundError('Item');
		}

		const item = await Item.findByIdAndUpdate(id, update, {
			new: true,
			runValidators: true,
		}).lean();

		if (!item) {
			throw new NotFoundError('Item');
		}

		// Guaranteed-fresh next read beats staying inside the TTL window.
		itemsCache.invalidate();

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
			});
		}

		res.status(200).json({ success: true, item });
	} catch (error) {
		handleHttpError(error, res, scopedLog);
	}
};

export const deleteItem = async (
	req: Request,
	res: Response,
): Promise<void> => {
	const { id } = req.params;
	const scopedLog = log.child({ itemId: id });

	try {
		const actor = requireLogActor(req);
		const item = await Item.findByIdAndDelete(id).lean();

		if (!item) {
			throw new NotFoundError('Item');
		}

		itemsCache.invalidate();

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
		});

		res.status(200).json({ success: true });
	} catch (error) {
		handleHttpError(error, res, scopedLog);
	}
};
