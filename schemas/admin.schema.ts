import { z } from '../util/zodTurkish';
import { PERMISSIONS } from '../constants/permissions.constant';

// z.nativeEnum accepts any plain string-valued object, so PERMISSIONS (the
// same `as const` object ALL_PERMISSIONS is built from) stays the one place
// the set of valid permissions is listed.
const permissionSchema = z.nativeEnum(PERMISSIONS);

export const createAdminSchema = z.object({
	email: z
		.string()
		.trim()
		.toLowerCase()
		.email('Geçerli bir e-posta adresi girin.'),
	username: z.string().trim().min(1, 'Kullanıcı adı girin.'),
	password: z.string().min(1, 'Şifre girin.'),
	permissions: z.array(permissionSchema).default([]),
});

export const updateAdminPermissionsSchema = z.object({
	permissions: z.array(permissionSchema),
});

export type CreateAdminInput = z.infer<typeof createAdminSchema>;
export type UpdateAdminPermissionsInput = z.infer<
	typeof updateAdminPermissionsSchema
>;
