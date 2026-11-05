import mongoose from 'mongoose';

const allocation = new mongoose.Schema(
	{
		lotId: { type: String, required: true },
		quantity: { type: Number, required: true },
	},
	{ _id: false },
);
const line = new mongoose.Schema(
	{
		type: { type: String, required: true },
		memoryGb: { type: Number, default: null },
		quantityUnit: { type: String, enum: ['piece', 'kg'], required: true },
		quantity: { type: Number, required: true },
		revenue: { type: Number, required: true },
		costOfGoods: { type: Number, required: true },
		averagePurchaseCost: { type: Number, required: true },
		previousQuantity: { type: Number, required: true },
		remainingQuantity: { type: Number, required: true },
		allocations: { type: [allocation], required: true },
	},
	{ _id: false },
);
const schema = new mongoose.Schema({
	_id: { type: String },
	requestId: { type: String, required: true },
	mode: { type: String, enum: ['complete', 'partial'], required: true },
	lines: { type: [line], required: true },
	totalRevenue: { type: Number, required: true },
	totalCostOfGoods: { type: Number, required: true },
	createdAt: { type: Date, required: true },
	createdBy: { type: mongoose.Schema.Types.ObjectId, required: true },
});
schema.index({ createdAt: -1 });
// All product rows and cost snapshots commit as one atomic MongoDB document.
export const StockRestock = mongoose.model('StockRestock', schema);
