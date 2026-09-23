import mongoose, { Types } from 'mongoose';
import type { DocumentWithTimestamps } from './User';
import { CURRENCY_VALUES } from '../schemas/item.schema';
import type { Currency } from '../schemas/item.schema';

const { Schema } = mongoose;

const pricingRuleSchema = new Schema<TimeStampedPricingRule>(
	{
		// BellekTipi category this rule prices, e.g. 'EMMC' / 'EMCP'.
		category: { type: String, required: true },
		sizeGb: { type: Number, required: true },
		price: { type: Number, required: true },
		currency: {
			type: String,
			enum: CURRENCY_VALUES,
			required: true,
			default: 'TRY',
		},
	},
	{ timestamps: true, collection: 'pricing_rules' },
);

// One price per (category, size) - editing changes the price on that pair;
// add/delete are how a pair itself comes and goes.
pricingRuleSchema.index({ category: 1, sizeGb: 1 }, { unique: true });

export const PricingRule = mongoose.model<TimeStampedPricingRule>(
	'PricingRule',
	pricingRuleSchema,
);

export type PricingRuleData = {
	category: string;
	sizeGb: number;
	price: number;
	currency: Currency;
};

export type TimeStampedPricingRule = DocumentWithTimestamps<PricingRuleData> & {
	_id: Types.ObjectId;
};
