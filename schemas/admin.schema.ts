import { z } from 'zod';
import { PERMISSIONS } from '../constants/permissions.constant';

// z.nativeEnum accepts any plain string-valued object, so PERMISSIONS (the
// same `as const` object ALL_PERMISSIONS is built from) stays the one place
// the set of valid permissions is listed.
const permissionSchema = z.nativeEnum(PERMISSIONS);

export const createAdminSchema = z.object({
	email: z.string().trim().toLowerCase().email('A valid email is required'),
	username: z.string().trim().min(1, 'username is required'),
	password: z.string().min(1, 'password is required'),
	permissions: z.array(permissionSchema).default([]),
});

export const updateAdminPermissionsSchema = z.object({
	permissions: z.array(permissionSchema),
});

export type CreateAdminInput = z.infer<typeof createAdminSchema>;
export type UpdateAdminPermissionsInput = z.infer<
	typeof updateAdminPermissionsSchema
>;
