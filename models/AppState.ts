import mongoose from 'mongoose';

const { Schema } = mongoose;

export const APP_STATE_ID = 'app';

// enabled arms the setting; it's only in effect inside [from, until).
// A null bound means "from now" / "until turned off".
export type Schedule = {
	enabled: boolean;
	from: Date | null;
	until: Date | null;
};

export type MaintenanceState = Schedule & {
	message: string | null;
};

export const NOTICE_TYPES = ['info', 'warning'] as const;
export type NoticeType = (typeof NOTICE_TYPES)[number];

export type NoticeState = Schedule & {
	message: string | null;
	type: NoticeType;
	// Route paths to show it on; empty means every public page.
	pages: string[];
	// Whether visitors can close it for the rest of their session.
	dismissible: boolean;
};

export type AppStateData = {
	_id: string;
	// Global data version - see services/sync/version.service.ts.
	version: number;
	maintenance: MaintenanceState;
	notice: NoticeState;
};

const scheduleFields = {
	enabled: { type: Boolean, required: true, default: false },
	from: { type: Date, default: null },
	until: { type: Date, default: null },
};

const maintenanceSchema = new Schema<MaintenanceState>(
	{
		...scheduleFields,
		message: { type: String, default: null },
	},
	{ _id: false },
);

const noticeSchema = new Schema<NoticeState>(
	{
		...scheduleFields,
		message: { type: String, default: null },
		type: { type: String, enum: NOTICE_TYPES, required: true, default: 'info' },
		pages: { type: [String], default: [] },
		dismissible: { type: Boolean, required: true, default: true },
	},
	{ _id: false },
);

// A single document (_id: APP_STATE_ID) holding site-wide state.
const appStateSchema = new Schema<AppStateData>(
	{
		_id: { type: String, required: true },
		version: { type: Number, required: true, default: 0 },
		maintenance: {
			type: maintenanceSchema,
			required: true,
			default: () => ({}),
		},
		notice: {
			type: noticeSchema,
			required: true,
			default: () => ({}),
		},
	},
	{ timestamps: true, collection: 'app_state' },
);

export const AppState = mongoose.model<AppStateData>('AppState', appStateSchema);
