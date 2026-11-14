import { z } from '../util/zodTurkish';

export const testEmailSchema = z
	.object({
		to: z
			.string()
			.trim()
			.toLowerCase()
			.max(254)
			.email('Geçerli bir e-posta adresi girin.'),
	})
	.strict();
