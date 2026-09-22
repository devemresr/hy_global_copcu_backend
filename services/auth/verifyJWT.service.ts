import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from './verifyAccessToken.service';
import { handleHttpError } from '../../errors/handleHttpError';
import { MissingAccessTokenError } from './auth.errors';
import logger from '../../util/logger';

const extractBearerToken = (authHeader: string | undefined): string | null => {
	if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
	return authHeader.split(' ')[1] ?? null;
};
const log = logger.child({ method: 'verifyJWT' });

/**
 * Flow:
 * - No / expired Bearer token => flag req.tokenRefreshNeeded and continue;
 *   it's the caller's job to decide what that means (requireAuth's
 *   rejectIfTokenRefreshNeeded rejects with 401 so the client can call
 *   POST /auth/refresh directly and retry, rather than this middleware
 *   trying to refresh inline)
 * - Valid token => attach userId/accessToken to req and continue
 */
export const verifyJwt = async (
	req: Request,
	res: Response,
	next: NextFunction,
) => {
	try {
		// Refresh token is present and live now evaluate the access token.
		const result = await verifyAccessToken(
			extractBearerToken(req.headers.authorization),
		);

		logger.debug({ result }, 'verifyjwt');

		switch (result.status) {
			case 'invalid':
				handleHttpError(new MissingAccessTokenError(), res, log);
				return;
			case 'refresh':
				req.userId = result?.userId as string;
				req.tokenRefreshNeeded = true;
				return next();
			case 'valid':
				req.userId = result.userId;
				req.accessToken = extractBearerToken(req.headers.authorization)!;
				req.tokenRefreshNeeded = false;
				return next();
		}
	} catch (error) {
		handleHttpError(error, res, log);
	}
};
