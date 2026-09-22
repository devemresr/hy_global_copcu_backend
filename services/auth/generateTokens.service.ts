import { type Response } from 'express';
import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import { JWT_EXPIRE_TIMES } from './constants/jwtConstants';
import env from '../../config/env';

export const generateAccessToken = (userId: string, email: string) => {
	const accessToken = jwt.sign(
		{
			userId,
			email,
			jti: nanoid(),
		},
		env.ACCESS_TOKEN_SECRET,
		// jsonwebtoken treats a numeric expiresIn as seconds
		{ expiresIn: JWT_EXPIRE_TIMES.ACCESSTOKEN },
	);

	return accessToken;
};

export const cookieOptions = {
	httpOnly: true,
	maxAge: 1000 * 60 * 60 * 24 * 30,
	sameSite: 'lax' as const,
	// only /auth/refresh reads this cookie. we dont send it to all routes since that would increase the attack vector for CSRF attacks.
	path: '/auth/refresh',
	secure: env.NODE_ENV === 'production',
};

export const setRefreshTokenCookie = (
	userId: string,
	email: string,
	res: Response,
) => {
	const refreshToken = generateRefreshToken(userId, email);
	res.cookie('jwt', refreshToken, cookieOptions);
};

const generateRefreshToken = (userId: string, email: string) => {
	const refreshToken = jwt.sign(
		{
			userId,
			email,
			jti: nanoid(),
		},
		env.REFRESH_TOKEN_SECRET,
		{ expiresIn: JWT_EXPIRE_TIMES.REFRESHTOKEN },
	);
	return refreshToken;
};
