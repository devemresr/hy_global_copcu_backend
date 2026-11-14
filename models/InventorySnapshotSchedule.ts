import mongoose from 'mongoose';
const schema = new mongoose.Schema(
	{
		_id: String,
		intervalMinutes: { type: Number, required: true, default: 60 },
		nextRunAt: { type: Date, required: true },
		lastExportedAt: { type: Date, default: null },
		lastItemCount: { type: Number, default: null },
		lastError: { type: String, default: null },
		lockedAt: { type: Date, default: null },
		claimId: { type: String, default: null },
	},
	{ timestamps: true },
);
export const InventorySnapshotSchedule = mongoose.model(
	'InventorySnapshotSchedule',
	schema,
);
