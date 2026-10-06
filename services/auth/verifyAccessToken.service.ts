import jwt from 'jsonwebtoken';
const { JsonWebTokenError, TokenExpiredError } = jwt;
import env from '../../config/env';
import { JWT_ALGORITHM } from './constants/jwtConstants';
import type { TokenPayload } from '../../util/token.helpers';

export type VerifyTokenResult =
	| { status: 'valid'; userId: string; jti: string }
	| { status: 'refresh' }
	| { status: 'invalid' };

export const verifyAccessToken = (
	accessToken: string | null,
): VerifyTokenResult => {
	if (!accessToken) {
		return { status: 'refresh' };
	}

	try {
		const decoded = jwt.verify(accessToken, env.ACCESS_TOKEN_SECRET, {
			algorithms: [JWT_ALGORITHM],
		}) as TokenPayload;

		return { status: 'valid', userId: decoded.userId, jti: decoded.jti };
	} catch (error) {
		// TokenExpiredError extends JsonWebTokenError, so it has to be checked first.
		if (error instanceof TokenExpiredError) return { status: 'refresh' };
		if (error instanceof JsonWebTokenError) return { status: 'invalid' };
		throw error;
	}
};
