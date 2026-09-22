import jwt from 'jsonwebtoken';
const { JsonWebTokenError, TokenExpiredError } = jwt;
import env from '../../config/env';
import type { TokenPayload } from '../../util/token.helpers';

export type VerifyTokenResult =
	| { status: 'valid'; userId: string; jti: string }
	| { status: 'refresh'; userId?: string }
	| { status: 'invalid' };

export const verifyAccessToken = async (
	accessToken: string | null,
): Promise<VerifyTokenResult> => {
	if (!accessToken) {
		return { status: 'refresh' };
	}

	try {
		const decoded = jwt.verify(
			accessToken,
			env.ACCESS_TOKEN_SECRET,
		) as TokenPayload;

		return { status: 'valid', userId: decoded.userId, jti: decoded.jti };
	} catch (error) {
		if (
			error instanceof TokenExpiredError ||
			error instanceof JsonWebTokenError
		) {
			try {
				const decoded = JSON.parse(atob(accessToken.split('.')[1]!));
				return { status: 'refresh', userId: decoded?.userId };
			} catch {
				return { status: 'refresh' };
			}
		}
		throw error;
	}
};
