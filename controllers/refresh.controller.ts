import type { Request, Response } from 'express';
import logger from '../util/logger';
import { User } from '../models/User';
import type { PublicUser } from '../models/User';
import { cookieOptions } from '../services/auth/generateTokens.service';
import { refreshAccessToken } from '../services/auth/refreshAccessToken.service';
import { InvalidSessionError } from '../services/auth/auth.errors';
import { handleHttpError } from '../errors/handleHttpError';

const log = logger.child({ method: 'refresh' });
const refresh = async (req: Request, res: Response): Promise<void> => {
	try {
		log.info('refresh request');

		const { accessToken, userId } = refreshAccessToken(req.cookies?.jwt);
		log.child({ userId });

		const user = await User.findById(userId)
			.select('-password -__v -createdAt -updatedAt')
			.lean<PublicUser>();
		if (!user) {
			res.clearCookie('jwt', cookieOptions);
			handleHttpError(
				new InvalidSessionError(`No user record found for userId ${userId}`),
				res,
				log,
			);
			return;
		}

		res.status(200).json({
			success: true,
			accessToken,
			user: user,
		});
	} catch (error) {
		res.clearCookie('jwt', cookieOptions);
		handleHttpError(error, res, log);
	}
};

export default refresh;
