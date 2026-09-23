import mongoose, { Types } from 'mongoose';
import type { DocumentWithTimestamps } from './User';
import { CURRENCY_VALUES, STORAGE_UNIT_VALUES } from '../schemas/item.schema';
import type { Currency, StorageUnit } from '../schemas/item.schema';

const { Schema } = mongoose;

const itemSchema = new Schema<TimeStampedItem>(
	{
		uretici: { type: String, required: false },
		ram: { type: String, required: false },
		eslesmeTuru: { type: String, required: false },
		bellekTipi: { type: String, required: false },
		sorgulananDeger: { type: String, required: false },
		model: { type: String, required: true, index: true },
		depolama: { type: Number, required: false, default: null },
		depolamaBirimi: {
			type: String,
			enum: STORAGE_UNIT_VALUES,
			required: true,
			default: 'GB',
		},
		fiyat: { type: Number, required: false, default: null },
		paraBirimi: {
			type: String,
			enum: CURRENCY_VALUES,
			required: true,
			default: 'TRY',
		},
	},
	{ timestamps: true, collection: 'items' },
);

export const Item = mongoose.model<TimeStampedItem>('Item', itemSchema);

export type ItemData = {
	uretici?: string | null;
	ram?: string | null;
	eslesmeTuru?: string | null;
	bellekTipi?: string | null;
	sorgulananDeger?: string | null;
	model: string;
	depolama?: number | null;
	depolamaBirimi: StorageUnit;
	fiyat: number | null;
	paraBirimi: Currency;
};

export type TimeStampedItem = DocumentWithTimestamps<ItemData> & {
	_id: Types.ObjectId;
};
