import { normalizeBayiPhone } from '../util/bayiPhone';
import { z } from 'zod';

export const normalizeBayiName = (name: string) =>
	name
		.normalize('NFKC')
		.trim()
		.replace(/\s+/gu, ' ')
		.toLocaleLowerCase('tr-TR');
export { normalizeBayiPhone } from '../util/bayiPhone';
export const bayiInputSchema = z
	.object({
		name: z
			.string()
			.max(500)
			.transform((name) => name.normalize('NFKC').trim().replace(/\s+/gu, ' '))
			.pipe(
				z
					.string()
					.min(1, 'Bayi adını girin.')
					.max(120, 'Bayi adı en fazla 120 karakter olabilir.'),
			),
		phone: z
			.string()
			.max(64)
			.transform(normalizeBayiPhone)
			.refine(Boolean, 'Geçerli bir telefon numarası girin.'),
	})
	.strict();
