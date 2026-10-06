import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import logger from '../util/logger';
import { User } from '../models/User';
import type { PublicUser } from '../models/User';
import { clearRefreshTokenCookie } from '../services/auth/generateTokens.service';
import { rotateSession } from '../services/auth/session.service';
import { REFRESH_COOKIE_NAME } from '../services/auth/constants/jwtConstants';
import { AuthError, InvalidSessionError } from '../services/auth/auth.errors';
import { handleHttpError } from '../errors/handleHttpError';

const { JsonWebTokenError } = jwt;
const log = logger.child({ method: 'refresh' });

const refresh = async (req: Request, res: Response): Promise<void> => {
	try {
		log.info('refresh request');

		const { accessToken, userId } = await rotateSession(
			req.cookies?.[REFRESH_COOKIE_NAME],
			res,
		);

		const user = await User.findById(userId)
			.select('-password -__v -createdAt -updatedAt')
			.lean<PublicUser>();
		if (!user) {
			throw new InvalidSessionError(`No user record found for userId ${userId}`);
		}

		res.status(200).json({
			success: true,
			accessToken,
			user: user,
		});
	} catch (error) {
		// Only a dead session drops the cookie - a DB hiccup shouldn't log the admin out.
		if (error instanceof AuthError || error instanceof JsonWebTokenError) {
			clearRefreshTokenCookie(res);
		}
		handleHttpError(error, res, log);
	}
};

export default refresh;
