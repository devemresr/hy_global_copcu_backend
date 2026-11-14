import mongoose from 'mongoose';

const schema = new mongoose.Schema(
	{
		_id: { type: String },
		recipients: { type: [String], default: undefined },
		includePdf: { type: Boolean, default: true },
		scheduleId: { type: String },
		receipt: { type: mongoose.Schema.Types.Mixed, required: true },
		status: {
			type: String,
			enum: ['pending', 'sending', 'sent', 'cancelled'],
			default: 'pending',
			required: true,
		},
		attempts: { type: Number, default: 0 },
		nextAttemptAt: { type: Date, default: Date.now },
		lockedAt: { type: Date, default: null },
		sentAt: { type: Date, default: null },
	},
	{ timestamps: true },
);
schema.index({ status: 1, nextAttemptAt: 1 });
export const TransactionEmail = mongoose.model('TransactionEmail', schema);
