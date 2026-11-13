import mongoose, { Types } from 'mongoose';
import type { DocumentWithTimestamps } from './User';
import { ACTIONS } from '../constants/permissions.constant';

const { Schema } = mongoose;

// Permission-gated actions plus site-settings changes, which are head-admin
// only and so have no permission of their own.
export const LOG_ACTIONS = {
	BAYI_CREATE: 'bayi:create',
	BAYI_UPDATE: 'bayi:update',
	INVESTOR_CREATE: 'finance:investor_create',
	INVESTOR_UPDATE: 'finance:investor_update',
	FINANCE_ENTRY_CREATE: 'finance:entry_create',
	FINANCE_ENTRY_VOID: 'finance:entry_void',
	FINANCE_CATEGORY_CREATE: 'finance:category_create',
	FINANCE_CATEGORY_UPDATE: 'finance:category_update',
	...ACTIONS,
	SITE_MAINTENANCE_UPDATE: 'site:maintenance_update',
	SITE_NOTICE_UPDATE: 'site:notice_update',
	SITE_PROMOTION_UPDATE: 'site:promotion_update',
	STOCK_RESTOCK_COMPLETE: 'stock:restock_complete',
	STOCK_RESTOCK_PARTIAL: 'stock:restock_partial',
	STOCK_PRICE_UPDATE: 'stock:price_update',
	STOCK_PURCHASE_CREATE: 'stock:purchase_create',
} as const;

export type LogAction = (typeof LOG_ACTIONS)[keyof typeof LOG_ACTIONS];

// What kind of record an action was taken on - items and site settings share
// one log collection instead of growing a near-duplicate model per entity.
export const LOG_ENTITY_TYPES = {
	BAYI: 'bayi',
	INVESTOR: 'investor',
	FINANCE_ENTRY: 'finance_entry',
	FINANCE_CATEGORY: 'finance_category',
	ITEM: 'item',
	ITEM_RULE: 'item_rule',
	SITE_MAINTENANCE: 'site_maintenance',
	SITE_NOTICE: 'site_notice',
	SITE_PROMOTION: 'site_promotion',
	STOCK_RESTOCK: 'stock_restock',
	STOCK_PRICE: 'stock_price',
	STOCK_PURCHASE: 'stock_purchase',
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
		bayiId: { type: Schema.Types.ObjectId, ref: 'Bayi', default: null },
		bayiName: { type: String, default: null },
		bayis: {
			type: [
				new Schema(
					{
						bayiId: { type: String, default: null },
						bayiName: { type: String, default: '' },
					},
					{ _id: false },
				),
			],
			default: undefined,
		},
		investorId: { type: String, default: null },
		investorName: { type: String, default: null },
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

logEventSchema.index({ bayiId: 1, createdAt: -1 });
logEventSchema.index({ 'bayis.bayiId': 1, createdAt: -1 });
logEventSchema.index({ investorId: 1, createdAt: -1 });

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
	bayiId?: Types.ObjectId | null;
	bayiName?: string | null;
	bayis?: { bayiId?: string | null; bayiName: string }[] | null;
	investorId?: string | null;
	investorName?: string | null;
	fields: FieldChange[];
	batchId?: string | null;
	version?: number | null;
};

export type TimeStampedLogEvent = DocumentWithTimestamps<LogEventData> & {
	_id: Types.ObjectId;
};
