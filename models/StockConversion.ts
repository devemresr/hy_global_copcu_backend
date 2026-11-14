import mongoose from 'mongoose';

const fields = {
	sourceLotId: { type: String },
	orderId: { type: String },
	bayiId: { type: String, default: '' },
	bayiName: { type: String, default: '' },
	type: { type: String },
	memoryGb: { type: Number, default: null },
	fromUnit: { type: String, enum: ['piece', 'kg', 'g'] },
	fromQuantity: { type: Number },
	toUnit: { type: String, enum: ['piece', 'kg', 'g'] },
	toQuantity: { type: Number },
	sourceQuantity: { type: Number },
	targetQuantity: { type: Number },
	cost: { type: Number },
};
const schema = new mongoose.Schema({
	_id: { type: String },
	requestId: { type: String, required: true },
	...fields,
	lines: {
		type: [new mongoose.Schema(fields, { _id: false })],
		default: undefined,
	},
	note: { type: String, default: '' },
	createdAt: { type: Date, required: true },
	createdBy: { type: mongoose.Schema.Types.ObjectId, required: true },
	adminUsername: { type: String, required: true },
});
schema.index({ createdAt: -1 });
export const StockConversion = mongoose.model('StockConversion', schema);
