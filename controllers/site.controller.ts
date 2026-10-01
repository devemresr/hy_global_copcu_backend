import type { Request, Response } from 'express';
import type {
	UpdateMaintenanceInput,
	UpdateNoticeInput,
} from '../schemas/site.schema';
import {
	getMaintenance,
	getNotice,
	getVersion,
	setMaintenance,
	setNotice,
} from '../services/sync/version.service';
import { LOG_ACTIONS, LOG_ENTITY_TYPES } from '../models/LogEvent';
import type { FieldChange } from '../models/LogEvent';
import { recordLogEvent } from '../services/logEvents/recordLogEvent.service';
import { requireUserId } from './auth.helper';
import { UnauthorizedError } from '../errors/HttpError';
import { handleHttpError } from '../errors/handleHttpError';
import logger from '../util/logger';

const log = logger.child({ controller: 'site' });

const toDate = (value: string | null | undefined) => (value ? new Date(value) : null);

// requireHeadAdmin always runs before these routes and sets adminUsername.
function requireLogActor(req: Request): { adminId: string; adminUsername: string } {
	const adminId = requireUserId(req);
	if (!req.adminUsername) {
		throw new UnauthorizedError(
			'adminUsername missing from request - authorize middleware did not run',
		);
	}
	return { adminId, adminUsername: req.adminUsername };
}

// Dates as ISO strings, page lists comma-joined ('' means every page).
function toLoggable(value: unknown): FieldChange['newValue'] {
	if (value instanceof Date) return value.toISOString();
	if (Array.isArray(value)) return value.join(', ');
	return (value as FieldChange['newValue']) ?? null;
}

function diffSettings<T extends object>(previous: T, next: T): FieldChange[] {
	return (Object.keys(next) as (keyof T & string)[])
		.map((field) => ({
			field,
			previousValue: toLoggable(previous[field]),
			newValue: toLoggable(next[field]),
		}))
		.filter((change) => change.previousValue !== change.newValue);
}

/**
 * GET /site/status - polled by every open tab. The ETag is the global
 * version, so an unchanged poll is an empty 304 that never touches Mongo.
 * `no-cache` lets the browser keep the body but forces it to revalidate.
 */
export const getSiteStatus = (req: Request, res: Response): void => {
	const version = getVersion();
	res.set('Cache-Control', 'no-cache');
	res.set('ETag', `"${version}"`);
	if (req.fresh) {
		res.status(304).end();
		return;
	}
	res.status(200).json({
		version,
		maintenance: getMaintenance(),
		notice: getNotice(),
	});
};

export const updateMaintenance = async (
	req: Request,
	res: Response,
): Promise<void> => {
	try {
		const actor = requireLogActor(req);
		const { enabled, message, from, until }: UpdateMaintenanceInput = req.body;
		const previous = getMaintenance();
		const maintenance = await setMaintenance({
			enabled,
			message: message || null,
			from: toDate(from),
			until: toDate(until),
		});
		const fields = diffSettings(previous, maintenance);
		if (fields.length > 0) {
			await recordLogEvent({
				...actor,
				action: LOG_ACTIONS.SITE_MAINTENANCE_UPDATE,
				entityType: LOG_ENTITY_TYPES.SITE_MAINTENANCE,
				entityId: null,
				entityKey: 'maintenance',
				fields,
				version: getVersion(),
			});
		}
		res.status(200).json({ success: true, version: getVersion(), maintenance });
	} catch (error) {
		handleHttpError(error, res, log);
	}
};

export const updateNotice = async (req: Request, res: Response): Promise<void> => {
	try {
		const actor = requireLogActor(req);
		const input: UpdateNoticeInput = req.body;
		const previous = getNotice();
		const notice = await setNotice({
			enabled: input.enabled,
			message: input.message || null,
			from: toDate(input.from),
			until: toDate(input.until),
			type: input.type,
			pages: [...new Set(input.pages)],
			dismissible: input.dismissible,
		});
		const fields = diffSettings(previous, notice);
		if (fields.length > 0) {
			await recordLogEvent({
				...actor,
				action: LOG_ACTIONS.SITE_NOTICE_UPDATE,
				entityType: LOG_ENTITY_TYPES.SITE_NOTICE,
				entityId: null,
				entityKey: 'notice',
				fields,
				version: getVersion(),
			});
		}
		res.status(200).json({ success: true, version: getVersion(), notice });
	} catch (error) {
		handleHttpError(error, res, log);
	}
};
