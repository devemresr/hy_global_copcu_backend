import mongoose, { Types } from 'mongoose';
import type { DocumentWithTimestamps } from './User';

const { Schema } = mongoose;

const itemSchema = new Schema<TimeStampedItem>(
	{
		manufacturer: { type: String, required: false },
		ram: { type: String, required: false },
		match_type: { type: String, required: false },
		BellekTipi: { type: String, required: false },
		queried_as: { type: String, required: false },
		Model: { type: String, required: true, index: true },
		Depoloma: { type: String, required: false },
		Fiyat: { type: Number, required: false, default: null },
		Currency: { type: String, enum: ['TRY', 'USD'], required: true, default: 'TRY' },
	},
	{ timestamps: true, collection: 'items' },
);

export const Item = mongoose.model<TimeStampedItem>('Item', itemSchema);

export type ItemData = {
	manufacturer?: string | null;
	ram?: string | null;
	match_type?: string | null;
	BellekTipi?: string | null;
	queried_as?: string | null;
	Model: string;
	Depoloma?: string | null;
	Fiyat: number | null;
	Currency: 'TRY' | 'USD';
};

export type TimeStampedItem = DocumentWithTimestamps<ItemData> & {
	_id: Types.ObjectId;
};
