import { parsePhoneNumberFromString } from 'libphonenumber-js/max';

export function normalizeBayiPhone(value: string): string {
	if (!/^[+\d\s().-]+$/.test(value.trim())) return '';
	let phone = value.trim().replace(/[\s().-]/g, '');
	if (phone.startsWith('00')) phone = `+${phone.slice(2)}`;
	if (
		!phone.startsWith('+') &&
		!(phone.length === 10 || (phone.length === 11 && phone.startsWith('0')))
	)
		phone = `+${phone}`;
	if (phone.startsWith('+900') && phone.length === 14)
		phone = `+90${phone.slice(4)}`;
	if (phone.replace(/\D/g, '').length > 15) return '';
	const parsed = parsePhoneNumberFromString(phone, {
		defaultCountry: 'TR',
		extract: false,
	});
	return parsed?.isValid() ? parsed.number : '';
}
