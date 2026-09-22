import mongoose, { Types } from 'mongoose';
import type { DocumentWithTimestamps } from './User';
import { ACTIONS } from '../constants/permissions.constant';

const { Schema } = mongoose;

export const LOG_ACTIONS = ACTIONS;

export type LogAction = (typeof LOG_ACTIONS)[keyof typeof LOG_ACTIONS];

// What kind of record an action was taken on - items and pricing rules share
// one log collection instead of growing a near-duplicate model per entity.
export const LOG_ENTITY_TYPES = {
	ITEM: 'item',
	PRICING_RULE: 'pricing_rule',
} as const;

export type LogEntityType =
	(typeof LOG_ENTITY_TYPES)[keyof typeof LOG_ENTITY_TYPES];

export type FieldChange = {
	field: string;
	previousValue: string | number | null;
	newValue: string | number | null;
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
		entityId: { type: Schema.Types.ObjectId, required: true },
		// Human-readable identity at the time of the action - a delete leaves
		// nothing left to join back to through entityId.
		entityKey: { type: String, required: true },
		fields: { type: [fieldChangeSchema], default: [] },
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
	entityId: Types.ObjectId;
	entityKey: string;
	fields: FieldChange[];
};

export type TimeStampedLogEvent = DocumentWithTimestamps<LogEventData> & {
	_id: Types.ObjectId;
};
