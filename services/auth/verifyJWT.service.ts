import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from './verifyAccessToken.service';
import { handleHttpError } from '../../errors/handleHttpError';
import { InvalidAccessTokenError } from './auth.errors';
import { extractBearerToken } from '../../util/token.helpers';
import logger from '../../util/logger';

const log = logger.child({ method: 'verifyJWT' });

/**
 * Flow:
 * - Bad signature / malformed token => 401 straight away
 * - No / expired Bearer token => flag req.tokenRefreshNeeded and continue;
 *   it's the caller's job to decide what that means (requireAuth's
 *   rejectIfTokenRefreshNeeded rejects with 401 so the client can call
 *   the refresh route directly and retry, rather than this middleware
 *   trying to refresh inline)
 * - Valid token => attach userId/accessToken to req and continue
 *
 * req.userId is only ever set from a verified token.
 */
export const verifyJwt = (req: Request, res: Response, next: NextFunction) => {
	try {
		const accessToken = extractBearerToken(req.headers.authorization);
		const result = verifyAccessToken(accessToken);

		log.debug({ status: result.status }, 'access token checked');

		switch (result.status) {
			case 'invalid':
				handleHttpError(new InvalidAccessTokenError(), res, log);
				return;
			case 'refresh':
				req.tokenRefreshNeeded = true;
				return next();
			case 'valid':
				req.userId = result.userId;
				req.accessToken = accessToken!;
				req.tokenRefreshNeeded = false;
				return next();
		}
	} catch (error) {
		handleHttpError(error, res, log);
	}
};
