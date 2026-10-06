import type { Response } from 'express';
import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import { Session } from '../../models/Session';
import {
	generateAccessToken,
	setRefreshTokenCookie,
} from './generateTokens.service';
import {
	JWT_ALGORITHM,
	JWT_EXPIRE_TIMES,
	ROTATION_GRACE_MS,
} from './constants/jwtConstants';
import {
	InvalidRefreshToken,
	MissingRefreshTokenError,
	RevokedSessionError,
} from './auth.errors';
import type { RefreshTokenPayload } from '../../util/token.helpers';
import logger from '../../util/logger';
import env from '../../config/env';

const { JsonWebTokenError } = jwt;
const log = logger.child({ service: 'session' });

/**
 * Server-side refresh sessions with rotation.
 *
 * Design choices:
 * - Every refresh swaps the refresh token for a new one (new jti) and the
 *   Session document records which jti is current. Presenting any older jti
 *   means the token was copied and replayed, so the whole session is deleted -
 *   both the attacker and the real user are logged out, rather than letting
 *   the attacker keep going for the rest of the 7 days.
 * - The new refresh token only ever travels in Set-Cookie (httpOnly), never in
 *   a response body, so rotating doesn't expose it to page JS.
 * - Sliding expiry: an active admin stays signed in, since each refresh
 *   restarts the 7-day idle window. SESSION_ABSOLUTE caps that from login, so
 *   a session can't be kept alive forever.
 * - ROTATION_GRACE_MS: two tabs can refresh with the same cookie at once, or
 *   a rotated response can be lost on the network and retried. Either way the
 *   just-replaced jti shows up again; inside the grace window that gets an
 *   access token plus a cookie for the current jti, instead of being treated
 *   as a replay. Past the window, an old jti can only be a copied token.
 */

const verifyRefreshToken = (
	refreshToken: string,
	options: { ignoreExpiration?: boolean } = {},
): RefreshTokenPayload => {
	const decoded = jwt.verify(refreshToken, env.REFRESH_TOKEN_SECRET, {
		algorithms: [JWT_ALGORITHM],
		...options,
	}) as RefreshTokenPayload;

	if (!decoded.sid || !decoded.jti) {
		throw new InvalidRefreshToken('Refresh token payload missing sid/jti claim');
	}
	return decoded;
};

/** Starts a session at login and sets its first refresh cookie. */
export const createSession = async (
	userId: string,
	email: string,
	res: Response,
) => {
	const sid = nanoid();
	const jti = nanoid();
	const expiresAt = new Date(
		Date.now() + JWT_EXPIRE_TIMES.SESSION_ABSOLUTE * 1000,
	);

	await Session.create({ _id: sid, userId, currentJti: jti, expiresAt });
	setRefreshTokenCookie({ userId, email, sid, jti }, expiresAt, res);
};

/**
 * Exchanges a refresh token for a new access token, rotating the refresh
 * cookie in the process.
 */
export const rotateSession = async (
	refreshToken: string | undefined,
	res: Response,
): Promise<{ accessToken: string; userId: string }> => {
	if (!refreshToken) throw new MissingRefreshTokenError();

	const { userId, email, sid, jti } = verifyRefreshToken(refreshToken);
	const now = new Date();
	const newJti = nanoid();

	// Matching on currentJti makes this the atomic "only one rotation wins".
	const rotated = await Session.findOneAndUpdate(
		{ _id: sid, currentJti: jti, expiresAt: { $gt: now } },
		{ currentJti: newJti, previousJti: jti, rotatedAt: now },
		{ returnDocument: 'after' },
	).lean();

	if (rotated) {
		setRefreshTokenCookie(
			{ userId, email, sid, jti: newJti },
			rotated.expiresAt,
			res,
		);
		log.info({ userId, sid }, 'refresh token rotated');
		return { accessToken: generateAccessToken(userId, email), userId };
	}

	const session = await Session.findById(sid).lean();
	if (!session || session.expiresAt <= now) {
		throw new RevokedSessionError(`No live session for sid ${sid}`);
	}

	const lostConcurrentRace =
		session.previousJti === jti &&
		session.rotatedAt !== null &&
		now.getTime() - session.rotatedAt.getTime() < ROTATION_GRACE_MS;

	if (lostConcurrentRace) {
		// Re-sent in case the winning response never reached the browser.
		setRefreshTokenCookie(
			{ userId, email, sid, jti: session.currentJti },
			session.expiresAt,
			res,
		);
		log.info({ userId, sid }, 'concurrent refresh inside grace window');
		return { accessToken: generateAccessToken(userId, email), userId };
	}

	await Session.deleteOne({ _id: sid });
	throw new RevokedSessionError(
		`Refresh token reuse detected for user ${userId}, session ${sid} revoked`,
	);
};

/**
 * Deletes the session behind a refresh token. A missing, malformed or
 * forged token is a no-op - logout should always succeed client-side.
 */
export const revokeSession = async (refreshToken: string | undefined) => {
	if (!refreshToken) return;

	let sid: string;
	try {
		// An expired token still names a session worth deleting.
		({ sid } = verifyRefreshToken(refreshToken, { ignoreExpiration: true }));
	} catch (error) {
		if (error instanceof JsonWebTokenError || error instanceof InvalidRefreshToken) {
			return;
		}
		throw error;
	}

	await Session.deleteOne({ _id: sid });
	log.info({ sid }, 'session revoked');
};
