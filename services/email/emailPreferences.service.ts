import { EmailPreferences } from '../../models/EmailPreferences';
export const DEFAULT_EMAIL_PREFERENCES = {
	purchase: true,
	sale: true,
	conversion: true,
	financeCreate: true,
	financeVoid: true,
};
export async function readEmailPreferences() {
	const stored = await EmailPreferences.findById('automatic').lean();
	return Object.fromEntries(
		(
			Object.keys(
				DEFAULT_EMAIL_PREFERENCES,
			) as (keyof typeof DEFAULT_EMAIL_PREFERENCES)[]
		).map((key) => [key, stored?.[key] ?? true]),
	) as typeof DEFAULT_EMAIL_PREFERENCES;
}
export async function automaticEmailEnabled(kind: string) {
	const keys: Record<string, keyof typeof DEFAULT_EMAIL_PREFERENCES> = {
		purchase: 'purchase',
		sale: 'sale',
		conversion: 'conversion',
		'finance-create': 'financeCreate',
		'finance-void': 'financeVoid',
	};
	return !keys[kind] || (await readEmailPreferences())[keys[kind]];
}
