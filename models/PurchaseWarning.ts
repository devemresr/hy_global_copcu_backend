import mongoose from 'mongoose';

const schema = new mongoose.Schema({
	_id: { type: String },
	bayiId: { type: mongoose.Schema.Types.ObjectId, required: true },
	productKey: { type: String, required: true },
	purchaseCycle: { type: String, required: true },
	triggeredAt: { type: Date, required: true },
	purchasePrice: { type: Number, required: true },
	sellingPrice: { type: Number, required: true },
});
// The unique id includes supplier, product and successful purchase count.
// A saved purchase changes the cycle; failed purchases and toast dismissal cannot.
export const PurchaseWarning = mongoose.model('PurchaseWarning', schema);
