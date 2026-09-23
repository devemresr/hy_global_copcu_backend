import type { Request, Response } from 'express';
import { PricingRule } from '../models/PricingRule';
import { LOG_ACTIONS, LOG_ENTITY_TYPES } from '../models/LogEvent';
import type { FieldChange } from '../models/LogEvent';
import type {
	AddPricingRuleInput,
	EditPricingRuleInput,
} from '../schemas/pricingRule.schema';
import { recordLogEvent } from '../services/logEvents/recordLogEvent.service';
import { createCachedFetcher } from '../util/queryCache';
import { requireUserId } from './auth.helper';
import {
	UnauthorizedError,
	NotFoundError,
	ConflictError,
} from '../errors/HttpError';
import { handleHttpError } from '../errors/handleHttpError';
import logger from '../util/logger';

const log = logger.child({ controller: 'pricingRules' });

// Same 5 min TTL as items - rules are read often, changed rarely, and every
// write below invalidates immediately anyway.
const PRICING_RULES_TTL_MS = 5 * 60 * 1000;

const pricingRulesCache = createCachedFetcher(
	() => PricingRule.find().lean(),
	{ ttlMs: PRICING_RULES_TTL_MS },
);

function ruleKey(rule: { category: string; sizeGb: number }): string {
	return `${rule.category}/${rule.sizeGb}GB`;
}

function isDuplicateKeyError(error: unknown): boolean {
	return (
		!!error &&
		typeof error === 'object' &&
		'code' in error &&
		error.code === 11000
	);
}

// requirePermission always runs before a mutating route below and sets both,
// so this narrows the optional Request fields once instead of at every call site.
function requireLogActor(req: Request): { adminId: string; adminUsername: string } {
	const adminId = requireUserId(req);
	if (!req.adminUsername) {
		throw new UnauthorizedError(
			'adminUsername missing from request - authorize middleware did not run',
		);
	}
	return { adminId, adminUsername: req.adminUsername };
}

export const listPricingRules = async (
	_req: Request,
	res: Response,
): Promise<void> => {
	try {
		const rules = await pricingRulesCache.get();
		res.status(200).json({ success: true, rules });
	} catch (error) {
		handleHttpError(error, res, log);
	}
};

export const addPricingRule = async (req: Request, res: Response): Promise<void> => {
	try {
		const actor = requireLogActor(req);
		const fields: AddPricingRuleInput = req.body;

		let rule;
		try {
			rule = await PricingRule.create(fields);
		} catch (createError) {
			if (isDuplicateKeyError(createError)) {
				throw new ConflictError('A rule for this category/size already exists');
			}
			throw createError;
		}
		pricingRulesCache.invalidate();

		const changedFields: FieldChange[] = [
			{ field: 'category', previousValue: null, newValue: rule.category },
			{ field: 'sizeGb', previousValue: null, newValue: rule.sizeGb },
			{ field: 'price', previousValue: null, newValue: rule.price },
			{ field: 'currency', previousValue: null, newValue: rule.currency },
		];
		await recordLogEvent({
			...actor,
			action: LOG_ACTIONS.ITEMS_ADD_RULE,
			entityType: LOG_ENTITY_TYPES.PRICING_RULE,
			entityId: rule._id.toString(),
			entityKey: ruleKey(rule),
			fields: changedFields,
		});

		res.status(201).json({ success: true, rule: rule.toObject() });
	} catch (error) {
		handleHttpError(error, res, log);
	}
};

export const editPricingRule = async (req: Request, res: Response): Promise<void> => {
	const { id } = req.params;
	const scopedLog = log.child({ ruleId: id });

	try {
		const actor = requireLogActor(req);
		const update: EditPricingRuleInput = req.body;

		const previous = await PricingRule.findById(id).lean();
		if (!previous) {
			throw new NotFoundError('Rule');
		}

		const rule = await PricingRule.findByIdAndUpdate(id, update, {
			new: true,
			runValidators: true,
		}).lean();

		if (!rule) {
			throw new NotFoundError('Rule');
		}

		pricingRulesCache.invalidate();

		// update only ever has keys that were actually sent (editPricingRuleSchema's
		// fields are plain .optional(), not defaulted - see its own comment).
		const changedFields: FieldChange[] = (
			Object.keys(update) as (keyof EditPricingRuleInput)[]
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
				action: LOG_ACTIONS.ITEMS_EDIT_RULE,
				entityType: LOG_ENTITY_TYPES.PRICING_RULE,
				entityId: rule._id.toString(),
				entityKey: ruleKey(rule),
				fields: changedFields,
			});
		}

		res.status(200).json({ success: true, rule });
	} catch (error) {
		handleHttpError(error, res, scopedLog);
	}
};

export const deletePricingRule = async (
	req: Request,
	res: Response,
): Promise<void> => {
	const { id } = req.params;
	const scopedLog = log.child({ ruleId: id });

	try {
		const actor = requireLogActor(req);
		const rule = await PricingRule.findByIdAndDelete(id).lean();

		if (!rule) {
			throw new NotFoundError('Rule');
		}

		pricingRulesCache.invalidate();

		const changedFields: FieldChange[] = [
			{ field: 'price', previousValue: rule.price, newValue: null },
			{ field: 'currency', previousValue: rule.currency, newValue: null },
		];
		await recordLogEvent({
			...actor,
			action: LOG_ACTIONS.ITEMS_DELETE_RULE,
			entityType: LOG_ENTITY_TYPES.PRICING_RULE,
			entityId: rule._id.toString(),
			entityKey: ruleKey(rule),
			fields: changedFields,
		});

		res.status(200).json({ success: true });
	} catch (error) {
		handleHttpError(error, res, scopedLog);
	}
};
