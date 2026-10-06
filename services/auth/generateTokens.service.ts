import { type Response } from 'express';
import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import {
	JWT_ALGORITHM,
	JWT_EXPIRE_TIMES,
	REFRESH_COOKIE_NAME,
} from './constants/jwtConstants';
import { AUTH_ROUTES } from '../../routes/routes.constant';
import type { RefreshTokenPayload } from '../../util/token.helpers';
import env from '../../config/env';

export const generateAccessToken = (userId: string, email: string) => {
	const accessToken = jwt.sign(
		{
			userId,
			email,
			jti: nanoid(),
		},
		env.ACCESS_TOKEN_SECRET,
		{ expiresIn: JWT_EXPIRE_TIMES.ACCESSTOKEN, algorithm: JWT_ALGORITHM },
	);

	return accessToken;
};

const refreshCookieOptions = {
	httpOnly: true,
	sameSite: 'lax' as const,
	// Only /auth/session/* receives this cookie, keeping it off every other route.
	path: AUTH_ROUTES.SESSION,
	secure: env.NODE_ENV === 'production',
};

/**
 * Signs a refresh token and sets it as the cookie. Its lifetime is the idle
 * timeout, cut short when the session's absolute cap comes first.
 */
export const setRefreshTokenCookie = (
	payload: RefreshTokenPayload,
	sessionExpiresAt: Date,
	res: Response,
) => {
	const lifetimeSeconds = Math.min(
		JWT_EXPIRE_TIMES.REFRESHTOKEN,
		Math.floor((sessionExpiresAt.getTime() - Date.now()) / 1000),
	);
	const refreshToken = jwt.sign(payload, env.REFRESH_TOKEN_SECRET, {
		expiresIn: lifetimeSeconds,
		algorithm: JWT_ALGORITHM,
	});
	res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
		...refreshCookieOptions,
		maxAge: lifetimeSeconds * 1000,
	});
};

export const clearRefreshTokenCookie = (res: Response) => {
	res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions);
};
