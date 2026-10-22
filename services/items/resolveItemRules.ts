import type { ItemRuleData } from '../../schemas/itemRule.schema';
import { updateItemSchema, type UpdateItemInput } from '../../schemas/item.schema';

function matches(item: UpdateItemInput, { field, op, value }: ItemRuleData['conditions'][number]): boolean {
	const raw = item[field];
	const present = raw != null && String(raw).trim() !== '';
	const text = String(raw ?? '').toLowerCase();
	const target = value.toLowerCase();
	switch (op) {
		case 'exists': return present;
		case 'notExists': return !present;
		case 'equals': return present && text === target;
		case 'notEquals': return !present || text !== target;
		case 'contains': return present && text.includes(target);
		case 'notContains': return !present || !text.includes(target);
		case 'in': case 'notIn': {
			const member = present && target.split(',').map((part) => part.trim()).filter(Boolean).includes(text);
			return op === 'in' ? member : !member;
		}
		case 'lengthEquals': case 'lengthGt': case 'lengthGte': case 'lengthLt': case 'lengthLte': {
			if (!present || field !== 'model') return false;
			const length = Array.from(String(raw).trim()).length;
			const count = Number(value);
			if (op === 'lengthEquals') return length === count;
			if (op === 'lengthGt') return length > count;
			if (op === 'lengthGte') return length >= count;
			if (op === 'lengthLt') return length < count;
			return length <= count;
		}
		default: {
			if (!present) return false;
			const numeric = typeof raw === 'number' ? raw : Number(String(raw).match(/-?\d+(?:\.\d+)?/)?.[0] ?? NaN);
			const limit = Number(value.match(/-?\d+(?:\.\d+)?/)?.[0] ?? NaN);
			if (op === 'gt') return numeric > limit;
			if (op === 'gte') return numeric >= limit;
			if (op === 'lt') return numeric < limit;
			return numeric <= limit;
		}
	}
}

/** Evaluate the post-edit item once, in priority order. First rule wins each field. */
export function resolveItemRuleDetails(previous: UpdateItemInput, fields: UpdateItemInput, rules: readonly ItemRuleData[]) {
	const item = { ...previous, ...fields };
	const result = { ...fields };
	const claimed = new Set<string>();
	const sources: Partial<Record<keyof UpdateItemInput, { id: string; name: string }>> = {};
	for (const rule of rules) {
		if (!rule.enabled || !rule.conditions.length || !rule.conditions.every((condition) => matches(item, condition))) continue;
		for (const action of rule.actions) {
			if (claimed.has(action.field)) continue;
			claimed.add(action.field);
			sources[action.field] = { id: rule.id, name: rule.name };
			const numeric = action.field === 'depolama' || action.field === 'fiyat';
			const enumeration = action.field === 'depolamaBirimi' || action.field === 'paraBirimi';
			const value = numeric ? (action.value.trim() === '' ? null : Number(action.value)) : enumeration ? action.value : action.value.trim() || null;
			Object.assign(item, { [action.field]: value });
			Object.assign(result, { [action.field]: value });
		}
	}
	return { fields: updateItemSchema.parse(result), sources };
}

export function resolveBulkItemRules(previous: UpdateItemInput, fields: UpdateItemInput, rules: readonly ItemRuleData[]): UpdateItemInput {
	return resolveItemRuleDetails(previous, fields, rules).fields;
}
