export const API_BASE_PATHS = {
	AUTH: '/auth',
	ITEMS: '/items',
	ADMINS: '/admins',
	PRICING_RULES: '/pricing-rules',
	LOG_EVENTS: '/log-events',
} as const;

export const AUTH_ROUTES = {
	LOGIN: `${API_BASE_PATHS.AUTH}/login`,
	REGISTER: `${API_BASE_PATHS.AUTH}/register`,
	REFRESH: `${API_BASE_PATHS.AUTH}/refresh`,
	UPDATE: `${API_BASE_PATHS.AUTH}/update`,
} as const;

export const ITEMS_ROUTES = {
	LIST: `${API_BASE_PATHS.ITEMS}`,
	CREATE: `${API_BASE_PATHS.ITEMS}`,
	// Registered before UPDATE in itemRoutes.ts - Express would otherwise match
	// PATCH /items/bulk against /items/:id first, treating "bulk" as an id.
	BULK_UPDATE: `${API_BASE_PATHS.ITEMS}/bulk`,
	UPDATE: `${API_BASE_PATHS.ITEMS}/:id`,
	DELETE: `${API_BASE_PATHS.ITEMS}/:id`,
} as const;

export const ADMIN_ROUTES = {
	LIST: `${API_BASE_PATHS.ADMINS}`,
	CREATE: `${API_BASE_PATHS.ADMINS}`,
	UPDATE_PERMISSIONS: `${API_BASE_PATHS.ADMINS}/:id/permissions`,
} as const;

export const PRICING_RULES_ROUTES = {
	LIST: `${API_BASE_PATHS.PRICING_RULES}`,
	CREATE: `${API_BASE_PATHS.PRICING_RULES}`,
	UPDATE: `${API_BASE_PATHS.PRICING_RULES}/:id`,
	DELETE: `${API_BASE_PATHS.PRICING_RULES}/:id`,
} as const;

export const LOG_EVENTS_ROUTES = {
	LIST: `${API_BASE_PATHS.LOG_EVENTS}`,
} as const;
