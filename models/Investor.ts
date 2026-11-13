import mongoose from 'mongoose';

const schema = new mongoose.Schema(
	{
		_id: { type: String },
		name: { type: String, required: true },
		nameKey: { type: String, required: true, unique: true },
		phone: { type: String },
		createdBy: { type: mongoose.Schema.Types.ObjectId, required: true },
	},
	{ timestamps: true },
);

schema.index(
	{ phone: 1 },
	{ unique: true, partialFilterExpression: { phone: { $type: 'string' } } },
);

export const Investor = mongoose.model('Investor', schema);
