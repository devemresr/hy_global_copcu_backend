import type { Response } from 'express';
import type { Logger } from 'pino';
import jwt from 'jsonwebtoken';
const { JsonWebTokenError, TokenExpiredError } = jwt;
import { HttpError } from './HttpError';
import { ExpiredRefreshTokenError, InvalidRefreshToken } from '../services/auth/auth.errors';
import env from '../config/env';

/**
 * Single catch-all dispatcher for every typed HttpError across the API -
 * the auth layer and resource routes (items/admins/pricing-rules) alike -
 * so status/message formatting never gets duplicated at each call site.
 * Callers throw a typed error and pass it here in one catch block; nothing
 * should call res.status(...).json(...) directly outside of this file.
 */
export const handleHttpError = (error: unknown, res: Response, log: Logger): void => {
	if (error instanceof HttpError) {
		log.warn({ err: error }, error.message);
		res.status(error.statusCode).json({ success: false, message: error.clientMessage });
		return;
	}

	// A raw jsonwebtoken error means it slipped past auth.errors.ts's own
	// typed throws unmapped - route it through the same typed path instead
	// of falling into the generic 500 branch below.
	if (error instanceof TokenExpiredError) {
		handleHttpError(new ExpiredRefreshTokenError(error.message), res, log);
		return;
	}
	if (error instanceof JsonWebTokenError) {
		handleHttpError(new InvalidRefreshToken(error.message), res, log);
		return;
	}

	if (error instanceof Error) {
		log.error({ err: error }, 'Unexpected error');
		res.status(500).json({
			success: false,
			message: 'Internal server error',
			...(env.NODE_ENV !== 'production' && { detail: error.message }),
		});
		return;
	}

	log.error({ err: error }, 'Unknown non-Error thrown');
	res.status(500).json({ success: false, message: 'Internal server error' });
};
