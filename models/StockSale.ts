import mongoose from 'mongoose';

const allocation = new mongoose.Schema(
	{
		lotId: { type: String, required: true },
		quantity: { type: Number, required: true },
	},
	{ _id: false },
);
const schema = new mongoose.Schema({
	_id: { type: String },
	requestId: { type: String, required: true },
	type: { type: String, required: true },
	memoryGb: { type: Number, default: null },
	quantityUnit: { type: String, enum: ['piece', 'kg'], required: true },
	quantity: { type: Number, required: true },
	mode: { type: String, enum: ['complete', 'partial'], required: true },
	revenue: { type: Number, required: true },
	costOfGoods: { type: Number, required: true },
	averagePurchaseCost: { type: Number, required: true },
	allocations: { type: [allocation], required: true },
	createdAt: { type: Date, required: true },
	createdBy: { type: mongoose.Schema.Types.ObjectId, required: true },
});
schema.index({ createdAt: -1 });
// Each sale atomically records all stock deductions and its immutable cost basis.
// The request UUID is also the Mongo primary key, making retries idempotent.
export const StockSale = mongoose.model('StockSale', schema);
