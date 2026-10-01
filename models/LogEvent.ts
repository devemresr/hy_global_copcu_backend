import mongoose, { Types } from 'mongoose';
import type { DocumentWithTimestamps } from './User';
import { ACTIONS } from '../constants/permissions.constant';

const { Schema } = mongoose;

// Permission-gated actions plus site-settings changes, which are head-admin
// only and so have no permission of their own.
export const LOG_ACTIONS = {
	...ACTIONS,
	SITE_MAINTENANCE_UPDATE: 'site:maintenance_update',
	SITE_NOTICE_UPDATE: 'site:notice_update',
} as const;

export type LogAction = (typeof LOG_ACTIONS)[keyof typeof LOG_ACTIONS];

// What kind of record an action was taken on - items and pricing rules share
// one log collection instead of growing a near-duplicate model per entity.
export const LOG_ENTITY_TYPES = {
	ITEM: 'item',
	PRICING_RULE: 'pricing_rule',
	SITE_MAINTENANCE: 'site_maintenance',
	SITE_NOTICE: 'site_notice',
} as const;

export type LogEntityType =
	(typeof LOG_ENTITY_TYPES)[keyof typeof LOG_ENTITY_TYPES];

export type FieldChange = {
	field: string;
	previousValue: string | number | boolean | null;
	newValue: string | number | boolean | null;
};

const fieldChangeSchema = new Schema<FieldChange>(
	{
		field: { type: String, required: true },
		previousValue: { type: Schema.Types.Mixed, default: null },
		newValue: { type: Schema.Types.Mixed, default: null },
	},
	{ _id: false },
);

const logEventSchema = new Schema<TimeStampedLogEvent>(
	{
		adminId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
		// Denormalized so a log entry stays readable even if the admin account
		// is later renamed or removed.
		adminUsername: { type: String, required: true },
		action: {
			type: String,
			enum: Object.values(LOG_ACTIONS),
			required: true,
		},
		entityType: {
			type: String,
			enum: Object.values(LOG_ENTITY_TYPES),
			required: true,
		},
		// Null for site settings, which are a single document with no row id.
		entityId: { type: Schema.Types.ObjectId, default: null },
		// Human-readable identity at the time of the action - a delete leaves
		// nothing left to join back to through entityId.
		entityKey: { type: String, required: true },
		fields: { type: [fieldChangeSchema], default: [] },
		// Shared by every row a single bulk request touches (see
		// items.controller.ts's bulkUpdateItems), null for anything else - lets
		// listLogEvents group a bulk edit's N per-row entries back into the one
		// event they actually came from instead of paginating over raw rows.
		batchId: { type: String, default: null, index: true },
		// The global data version this change was written at (items only).
		version: { type: Number, default: null },
	},
	{ timestamps: true, collection: 'log_events' },
);

export const LogEvent = mongoose.model<TimeStampedLogEvent>(
	'LogEvent',
	logEventSchema,
);

export type LogEventData = {
	adminId: Types.ObjectId;
	adminUsername: string;
	action: LogAction;
	entityType: LogEntityType;
	entityId: Types.ObjectId | null;
	entityKey: string;
	fields: FieldChange[];
	batchId?: string | null;
	version?: number | null;
};

export type TimeStampedLogEvent = DocumentWithTimestamps<LogEventData> & {
	_id: Types.ObjectId;
};
