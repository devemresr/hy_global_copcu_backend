import mongoose from 'mongoose';
const schema = new mongoose.Schema(
	{
		_id: String,
		purchase: { type: Boolean, default: true },
		sale: { type: Boolean, default: true },
		conversion: { type: Boolean, default: true },
		financeCreate: { type: Boolean, default: true },
		financeVoid: { type: Boolean, default: true },
	},
	{ timestamps: true },
);
export const EmailPreferences = mongoose.model('EmailPreferences', schema);
