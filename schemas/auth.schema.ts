import { z } from 'zod';

export const loginSchema = z.object({
	email: z.string().trim().toLowerCase().email('A valid email is required'),
	password: z.string().min(1, 'password is required'),
});

export type LoginInput = z.infer<typeof loginSchema>;
