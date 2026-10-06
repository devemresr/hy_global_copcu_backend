// All values in seconds - jsonwebtoken treats a numeric expiresIn as seconds.
export const JWT_EXPIRE_TIMES = {
	ACCESSTOKEN: 15 * 60, // 15m
	// Idle timeout: each refresh issues a fresh token with this lifetime.
	REFRESHTOKEN: 7 * 24 * 60 * 60, // 7 days
	// Hard cap from login, however active the session stays.
	SESSION_ABSOLUTE: 60 * 24 * 60 * 60, // 60 days
} as const;

export const JWT_ALGORITHM = 'HS256' as const;

export const REFRESH_COOKIE_NAME = 'jwt';

// Lets a second tab that refreshed with the just-rotated token through
// instead of tripping reuse detection.
export const ROTATION_GRACE_MS = 30_000;
