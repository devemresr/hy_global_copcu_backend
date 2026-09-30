export const JWT_EXPIRE_TIMES = {
	ACCESSTOKEN: 15 * 60, // 15m
	REFRESHTOKEN: 7 * 24 * 60 * 60, // 7 days
} as const;
