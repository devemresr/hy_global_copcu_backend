import type { PublicUser } from '../models/User';
import {
	generateAccessToken,
	setRefreshTokenCookie,
} from '../services/auth/generateTokens.service';
import type { NextFunction, Request, Response } from 'express';
import { verifyJwt } from '../services/auth/verifyJWT.service';
import { AccessTokenExpiredError, AuthResponseError } from '../services/auth/auth.errors';
import { UnauthorizedError } from '../errors/HttpError';
import { handleHttpError } from '../errors/handleHttpError';
import logger from '../util/logger';

const log = logger.child({ helper: 'auth' });

export const issueAuthResponse = (user: PublicUser, res: Response) => {
	try {
		const { email } = user;
		const userId = user._id.toHexString();

		const accessToken = generateAccessToken(userId, email);
		setRefreshTokenCookie(userId, email, res);
		return res.status(200).json({ accessToken, user });
	} catch (error) {
		log.error({ err: error }, 'Failed to issue auth response');
		return handleHttpError(new AuthResponseError(), res, log);
	}
};

export const requireUserId = (req: Request): string => {
	if (!req.userId) {
		throw new UnauthorizedError(
			'userId missing from request - auth middleware did not run',
		);
	}
	return req.userId;
};

// The refresh cookie is scoped to /auth/refresh (see generateTokens.service's
// cookieOptions), so no other route can read it to refresh inline. Rejecting
// here instead lets the client's own refresh-then-retry (apiFetch's 401
// handler, backed by tokenManager's proactive refresh) recover cleanly
// through a dedicated call to /auth/refresh, where the cookie is available.
const rejectIfTokenRefreshNeeded = (
	req: Request,
	res: Response,
	next: NextFunction,
): void => {
	if (req.tokenRefreshNeeded) {
		handleHttpError(new AccessTokenExpiredError(), res, log);
		return;
	}
	next();
};

export const requireAuth = () => [verifyJwt, rejectIfTokenRefreshNeeded];
