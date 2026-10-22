import { z } from 'zod';
import { editableItemFieldsSchema } from './item.schema';

const fields = ['model', 'bellekTipi', 'depolama', 'depolamaBirimi', 'fiyat', 'paraBirimi'] as const;
const numberOps = ['equals', 'notEquals', 'gt', 'gte', 'lt', 'lte', 'exists', 'notExists'];
const textOps = ['equals', 'notEquals', 'contains', 'notContains', 'in', 'notIn', 'exists', 'notExists'];
const enumOps = ['equals', 'notEquals', 'exists', 'notExists'];
const lengthOps = ['lengthEquals', 'lengthGt', 'lengthGte', 'lengthLt', 'lengthLte'];
const conditionSchema = z.object({
	field: z.enum(fields),
	op: z.enum(['equals', 'notEquals', 'contains', 'notContains', 'in', 'notIn', 'gt', 'gte', 'lt', 'lte', 'exists', 'notExists', 'lengthEquals', 'lengthGt', 'lengthGte', 'lengthLt', 'lengthLte']),
	value: z.string().max(10000),
}).strict().superRefine((condition, context) => {
	const allowed = condition.field === 'model' ? [...textOps, ...lengthOps] : ['depolama', 'fiyat'].includes(condition.field) ? numberOps : ['depolamaBirimi', 'paraBirimi'].includes(condition.field) ? enumOps : textOps;
	if (!allowed.includes(condition.op)) context.addIssue({ code: 'custom', message: 'Geçersiz filtre işleci' });
	if (lengthOps.includes(condition.op) && (!/^\d+$/.test(condition.value.trim()) || !Number.isSafeInteger(Number(condition.value)))) context.addIssue({ code: 'custom', message: 'Karakter sayısı sıfır veya pozitif bir tam sayı olmalıdır' });
	if (!['exists', 'notExists'].includes(condition.op) && !condition.value.trim()) context.addIssue({ code: 'custom', message: 'Filtre değeri boş olamaz' });
});
const actionSchema = z.object({ field: z.enum(fields), value: z.string().max(10000) }).strict().superRefine((action, context) => {
	const numeric = ['depolama', 'fiyat'].includes(action.field);
	const enumeration = ['depolamaBirimi', 'paraBirimi'].includes(action.field);
	const value = numeric ? (action.value.trim() === '' ? null : Number(action.value)) : enumeration ? action.value : action.value.trim() || null;
	const parsed = editableItemFieldsSchema.shape[action.field].safeParse(value);
	if (!parsed.success) context.addIssue({ code: 'custom', message: parsed.error.issues[0].message });
});
export const itemRuleSchema = z.object({
	id: z.string().min(1).max(100).regex(/^[\w-]+$/),
	name: z.string().trim().min(1).max(100),
	enabled: z.boolean(),
	conditions: z.array(conditionSchema).min(1).max(100),
	actions: z.array(actionSchema).min(1).max(fields.length).refine((actions) => new Set(actions.map((action) => action.field)).size === actions.length, 'Bir alan yalnızca bir kez seçilebilir'),
}).strict();
export const saveItemRulesSchema = z.object({
	revision: z.number().int().nonnegative(),
	rules: z.array(itemRuleSchema).max(500).refine((rules) => new Set(rules.map((rule) => rule.id)).size === rules.length, 'Kural kimlikleri benzersiz olmalıdır'),
}).strict();
export type ItemRuleData = z.infer<typeof itemRuleSchema>;
export type SaveItemRulesInput = z.infer<typeof saveItemRulesSchema>;
