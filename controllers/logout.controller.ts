import type { Request, Response } from 'express';
import logger from '../util/logger';
import { clearRefreshTokenCookie } from '../services/auth/generateTokens.service';
import { revokeSession } from '../services/auth/session.service';
import { REFRESH_COOKIE_NAME } from '../services/auth/constants/jwtConstants';
import { handleHttpError } from '../errors/handleHttpError';

const log = logger.child({ method: 'logout' });

/**
 * Deletes the session behind the refresh cookie and clears the cookie.
 * Identified by the refresh cookie rather than the access token, so it still
 * works once the access token has expired. Always 204 for a missing or bad
 * cookie - there's nothing left to log out of.
 *
 * An access token issued before logout stays valid until it expires (15m);
 * the client discards its copy.
 */
const logout = async (req: Request, res: Response): Promise<void> => {
	try {
		await revokeSession(req.cookies?.[REFRESH_COOKIE_NAME]);
		clearRefreshTokenCookie(res);
		res.status(204).end();
	} catch (error) {
		clearRefreshTokenCookie(res);
		handleHttpError(error, res, log);
	}
};

export default logout;
