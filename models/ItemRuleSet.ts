import mongoose from 'mongoose';
import type { ItemRuleData } from '../schemas/itemRule.schema';

export const ITEM_RULE_SET_ID = 'creation';
type RuleSetData = { _id: string; revision: number; rules: ItemRuleData[] };
const conditionSchema = new mongoose.Schema<ItemRuleData['conditions'][number]>({
	field: { type: String, required: true },
	op: { type: String, required: true },
	value: { type: String, default: '' },
}, { _id: false });
const actionSchema = new mongoose.Schema<ItemRuleData['actions'][number]>({
	field: { type: String, required: true },
	value: { type: String, default: '' },
}, { _id: false });
const ruleSchema = new mongoose.Schema<ItemRuleData>({
	id: { type: String, required: true },
	name: { type: String, required: true },
	enabled: { type: Boolean, required: true },
	conditions: { type: [conditionSchema], required: true },
	actions: { type: [actionSchema], required: true },
}, { _id: false, id: false });
const schema = new mongoose.Schema<RuleSetData>({
	_id: { type: String, required: true },
	revision: { type: Number, required: true, default: 0 },
	rules: { type: [ruleSchema], default: [] },
}, { timestamps: true, collection: 'item_rule_sets' });
export const ItemRuleSet = mongoose.model<RuleSetData>('ItemRuleSet', schema);
