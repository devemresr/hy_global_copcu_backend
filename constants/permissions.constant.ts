export const ACTIONS = {
	ITEMS_CREATE: 'items:create',
	ITEMS_UPDATE: 'items:update',
	ITEMS_DELETE: 'items:delete',
	ITEMS_ADD_RULE: 'items:add_rule',
	ITEMS_DELETE_RULE: 'items:delete_rule',
	ITEMS_EDIT_RULE: 'items:edit_rule',
} as const;
export const PERMISSIONS = ACTIONS;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

export const ADMIN_ROLES = {
	// Implicitly holds every permission - never stored in an admin's own
	// `permissions` array, checked as a role instead.
	HEAD_ADMIN: 'head_admin',
	ADMIN: 'admin',
} as const;

export type AdminRole = (typeof ADMIN_ROLES)[keyof typeof ADMIN_ROLES];
export const ALL_ADMIN_ROLES: AdminRole[] = Object.values(ADMIN_ROLES);
