import mongoose from 'mongoose';

const lineSchema = new mongoose.Schema(
	{
		type: { type: String, required: true },
		quantity: { type: Number, required: true },
		memoryGb: { type: Number, default: null },
		requiresMemorySize: { type: Boolean },
		quantityUnit: {
			type: String,
			enum: ['piece', 'kg', 'g'],
			default: 'piece',
		},
		unitPrice: { type: Number, required: true },
		originalUnitPrice: { type: Number, default: null },
		priceAdjustment: { type: Number, default: null },
		total: { type: Number, required: true },
	},
	{ _id: false },
);
const orderSchema = new mongoose.Schema(
	{
		name: { type: String, required: true, trim: true, maxlength: 120 },
		bayiId: { type: mongoose.Schema.Types.ObjectId, ref: 'Bayi' },
		bayiPhone: { type: String },
		lines: { type: [lineSchema], required: true },
		total: { type: Number, required: true },
		quantity: { type: Number, required: true },
		unitTotals: {
			type: new mongoose.Schema(
				{
					piece: { type: Number, default: 0 },
					kg: { type: Number, default: 0 },
					g: { type: Number, default: 0 },
				},
				{ _id: false },
			),
		},
		createdBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'User',
			required: true,
		},
	},
	{ timestamps: true },
);
orderSchema.index({ createdAt: -1, _id: -1 });
orderSchema.index({ total: 1, createdAt: -1 });
orderSchema.index({ bayiId: 1 });
export const Order = mongoose.model('Order', orderSchema);
