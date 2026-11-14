import mongoose from 'mongoose';

const schema = new mongoose.Schema(
	{
		name: { type: String, required: true },
		source: { type: String, enum: ['analysis', 'umami'], default: 'analysis' },
		analysisUrl: { type: String, default: '' },
		includeData: { type: Boolean, default: true },
		enabled: { type: Boolean, default: false },
		includePdf: { type: Boolean, default: true },
		frequency: {
			type: String,
			enum: ['daily', 'weekly', 'monthly'],
			required: true,
		},
		time: { type: String, required: true },
		weekday: { type: Number, required: true },
		monthDay: { type: Number, required: true },
		relativePeriod: { type: String, required: true },
		recipients: { type: [String], default: [] },
		createdBy: { type: mongoose.Schema.Types.ObjectId, required: true },
		createdByName: { type: String, default: null },
		updatedBy: { type: mongoose.Schema.Types.ObjectId },
		adminName: { type: String, required: true },
		nextRunAt: { type: Date, required: true },
		lockedAt: { type: Date, default: null },
		pendingRunAt: { type: Date, default: null },
		lastQueuedAt: { type: Date, default: null },
		lastError: { type: String, default: null },
	},
	{ timestamps: true },
);
schema.index({ enabled: 1, nextRunAt: 1 });
export const ReportSchedule = mongoose.model('ReportSchedule', schema);
