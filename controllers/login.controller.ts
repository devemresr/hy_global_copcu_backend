import * as bcrypt from 'bcryptjs';
import type { Request, Response } from 'express';
import { User } from '../models/User';
import type { TimeStampedUser } from '../models/User';
import type { LoginInput } from '../schemas/auth.schema';
import logger from '../util/logger';
import { issueAuthResponse } from './auth.helper';
import { InvalidCredentialsError } from '../services/auth/auth.errors';
import { handleHttpError } from '../errors/handleHttpError';

const log = logger.child({ method: 'login' });
export const SALT_ROUNDS = 10;

// Used to keep bcrypt.compare on the same code path (and roughly the same
// timing) whether or not the account exists, so a non-existent email can't
// be distinguished from a wrong password via response time.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(
	'no-such-account-placeholder',
	SALT_ROUNDS,
);

/**
 * Validates credentials and issues an auth response (tokens + cookie).
 */
const login = async (req: Request, res: Response): Promise<void> => {
	// validateBody(loginSchema) has already trimmed/lowercased email by the
	// time this runs.
	const { email, password: reqPassword }: LoginInput = req.body;
	try {
		const user = await User.findOne({ email })
			.select('+password -__v')
			.lean<TimeStampedUser>();

		const isMatch = await bcrypt.compare(
			reqPassword,
			user?.password ?? DUMMY_PASSWORD_HASH,
		);

		if (!user || !isMatch) {
			log.warn(
				{ email },
				user
					? 'Login attempt with wrong password'
					: 'Login attempt for non-existent user',
			);
			handleHttpError(new InvalidCredentialsError(), res, log);
			return;
		}

		const {
			password: _password,
			createdAt: _createdAt,
			updatedAt: _updatedAt,
			...publicUser
		} = user;

		log.info({ userId: user._id.toString() }, 'User logged in');

		issueAuthResponse(publicUser, res);
	} catch (error: unknown) {
		handleHttpError(error, res, log);
	}
};

export default login;
