import mongoose from 'mongoose';

const bayiSchema = new mongoose.Schema(
	{
		name: { type: String, required: true, trim: true, maxlength: 120 },
		nameKey: { type: String, required: true, unique: true, select: false },
		phone: { type: String, required: true, unique: true },
	},
	{ timestamps: true },
);
export const Bayi = mongoose.model('Bayi', bayiSchema);
