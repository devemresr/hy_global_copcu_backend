import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../services/auth/verifyAccessToken.service';
import {
	getMaintenance,
	isMaintenanceActive,
} from '../services/sync/version.service';
import { AccessTokenExpiredError } from '../services/auth/auth.errors';
import { handleHttpError } from '../errors/handleHttpError';
import logger from '../util/logger';

const log = logger.child({ middleware: 'maintenance' });

/**
 * Blocks public reads while maintenance is on, so the holding page isn't
 * just a client-side screen. Signed-in admins still get through; an expired
 * admin token gets a 401 (not a 503) so the client's refresh-and-retry runs.
 */
export const blockPublicDuringMaintenance = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	if (!isMaintenanceActive()) {
		next();
		return;
	}

	try {
		const header = req.headers.authorization;
		const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
		if (token) {
			const result = await verifyAccessToken(token);
			if (result.status === 'valid') {
				next();
				return;
			}
			throw new AccessTokenExpiredError();
		}

		res.status(503).json({
			error: 'Service temporarily unavailable',
			maintenance: getMaintenance(),
		});
	} catch (error) {
		handleHttpError(error, res, log);
	}
};
