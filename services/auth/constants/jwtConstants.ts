import env from '../../../config/env';

export const JWT_EXPIRE_TIMES = {
	ACCESSTOKEN:
		env.NODE_ENV === 'production'
			? 15 * 60 // 15m
			: 6 * 24 * 60 * 60, // 6d
	REFRESHTOKEN: 7 * 24 * 60 * 60, // 7 days
} as const;
