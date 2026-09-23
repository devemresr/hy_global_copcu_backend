import { z } from 'zod';
import { currencySchema } from './item.schema';

// One place for a pricing rule's shape - addPricingRuleSchema/
// editPricingRuleSchema and PricingRuleData (models/PricingRule.ts) all
// derive from this instead of the controller hand-checking types per field.
// editPricingRuleSchema is built independently rather than via
// .pick().partial() on addPricingRuleSchema: reusing its defaulted `currency`
// field would make an edit that omits currency silently reset it to 'TRY'
// instead of leaving it untouched, since zod applies a field's .default() to
// a key that's simply absent from the input, not just one set to undefined.
const priceSchema = z.number().nonnegative('price must be a non-negative number');

export const addPricingRuleSchema = z.object({
	category: z.string().trim().min(1, 'category is required'),
	sizeGb: z.number().positive('sizeGb must be a positive number'),
	price: priceSchema,
	// Matches the Mongoose schema's own default.
	currency: currencySchema.default('TRY'),
});

// A rule's (category, sizeGb) identity isn't editable in place - only what it
// resolves to is (see PricingRule.ts's index comment).
export const editPricingRuleSchema = z.object({
	price: priceSchema.optional(),
	currency: currencySchema.optional(),
});

export type AddPricingRuleInput = z.infer<typeof addPricingRuleSchema>;
export type EditPricingRuleInput = z.infer<typeof editPricingRuleSchema>;
