import { z } from '../util/zodTurkish';

export const loginSchema = z.object({
	email: z
		.string()
		.trim()
		.toLowerCase()
		.email('Geçerli bir e-posta adresi girin.'),
	password: z.string().min(1, 'Şifre girin.'),
});

export type LoginInput = z.infer<typeof loginSchema>;
