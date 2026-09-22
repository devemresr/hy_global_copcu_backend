import jwt from 'jsonwebtoken';
import { generateAccessToken } from './generateTokens.service';
import logger from '../../util/logger';
import type { TokenPayload } from '../../util/token.helpers';
import { InvalidRefreshToken, MissingRefreshTokenError } from './auth.errors';
import env from '../../config/env';

const log = logger.child({ method: 'refreshAccessToken' });

/**
 * Verifies the refresh cookie and mints a fresh access token from it.
 *
 * Called directly by the /auth/refresh route handler rather than run as
 * middleware ahead of it: the refresh cookie is scoped to that one route
 * (see generateTokens.service's cookieOptions), and with proactive refresh
 * on the client every stale-access-token case already lands here as its own
 * dedicated call, so there's no "maybe refresh, maybe not" request to guard
 * with a tokenRefreshNeeded flag - this function either has a valid refresh
 * token to work with or it doesn't.
 */
export const refreshAccessToken = (
	refreshToken: string | undefined,
): { accessToken: string; userId: string; email: string } => {
	if (!refreshToken) throw new MissingRefreshTokenError();

	const decodedRefreshToken = jwt.verify(
		refreshToken,
		env.REFRESH_TOKEN_SECRET,
	) as TokenPayload;

	log.info(
		{ userId: decodedRefreshToken.userId, refreshJti: decodedRefreshToken.jti },
		'refresh token decoded',
	);

	/**
	 * A blacklisted refresh token means the session was explicitly revoked
	 * (e.g. logout). Reject immediately regardless of the access token state
	 * minting a new access token against a dead session would defeat the
	 * purpose of blacklisting.
	 */
	if (!decodedRefreshToken.jti) {
		throw new InvalidRefreshToken('Refresh token payload missing jti claim');
	}

	const accessToken = generateAccessToken(
		decodedRefreshToken.userId,
		decodedRefreshToken.email,
	);

	log.info({ userId: decodedRefreshToken.userId }, 'Access token refreshed successfully');

	return {
		accessToken,
		userId: decodedRefreshToken.userId,
		email: decodedRefreshToken.email,
	};
};

export default refreshAccessToken;
