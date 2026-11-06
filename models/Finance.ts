import mongoose from 'mongoose';

export const FINANCE_GROUPS = [
	'purchase',
	'other',
	'sale',
	'investment',
] as const;
const category = new mongoose.Schema(
	{
		_id: { type: String },
		group: { type: String, enum: FINANCE_GROUPS, required: true },
		name: { type: String, required: true },
		nameKey: { type: String, required: true },
		createdBy: { type: mongoose.Schema.Types.ObjectId, required: true },
	},
	{ timestamps: true },
);
category.index({ group: 1, nameKey: 1 }, { unique: true });
export const FinanceCategory = mongoose.model('FinanceCategory', category);
const entry = new mongoose.Schema(
	{
		_id: { type: String },
		categoryId: { type: String, required: true },
		group: { type: String, enum: FINANCE_GROUPS, required: true },
		subtype: { type: String, required: true },
		amountCents: { type: Number, required: true, min: 1, max: 1e14 },
		date: { type: String, required: true },
		description: { type: String, default: '' },
		createdBy: { type: mongoose.Schema.Types.ObjectId, required: true },
		voidedAt: { type: Date, default: null },
	},
	{ timestamps: true },
);
entry.index({ date: -1 });
export const FinanceEntry = mongoose.model('FinanceEntry', entry);
