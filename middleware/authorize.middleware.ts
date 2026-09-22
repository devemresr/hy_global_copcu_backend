import type { Request, Response, NextFunction } from 'express';
import { User } from '../models/User';
import { requireUserId } from '../controllers/auth.helper';
import { ADMIN_ROLES } from '../constants/permissions.constant';
import type { Permission } from '../constants/permissions.constant';
import { UnauthorizedError, ForbiddenError } from '../errors/HttpError';
import { handleHttpError } from '../errors/handleHttpError';
import logger from '../util/logger';

const log = logger.child({ middleware: 'authorize' });

type AdminAuth = { role: string; permissions: string[]; username: string };

// Deliberately not cached like queryCache's item reads: a revoked permission
// must take effect on the very next request, not after some TTL window.
// These are low-traffic admin actions, so the extra Mongo round trip per
// request is cheap insurance against a stale grant.
async function loadAdminAuth(userId: string): Promise<AdminAuth | null> {
	return User.findById(userId)
		.select('role permissions username')
		.lean<AdminAuth>();
}

export const requirePermission = (permission: Permission) => {
	return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
		try {
			const userId = requireUserId(req);
			const admin = await loadAdminAuth(userId);

			if (!admin) {
				throw new UnauthorizedError(`No user record found for userId ${userId}`);
			}

			if (
				admin.role === ADMIN_ROLES.HEAD_ADMIN ||
				admin.permissions.includes(permission)
			) {
				req.adminUsername = admin.username;
				next();
				return;
			}

			throw new ForbiddenError(
				`User ${userId} (role ${admin.role}) lacks permission ${permission}`,
			);
		} catch (error) {
			handleHttpError(error, res, log);
		}
	};
};

export const requireHeadAdmin = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const userId = requireUserId(req);
		const admin = await loadAdminAuth(userId);

		if (!admin) {
			throw new UnauthorizedError(`No user record found for userId ${userId}`);
		}

		if (admin.role === ADMIN_ROLES.HEAD_ADMIN) {
			req.adminUsername = admin.username;
			next();
			return;
		}

		throw new ForbiddenError(`User ${userId} (role ${admin.role}) is not a head admin`);
	} catch (error) {
		handleHttpError(error, res, log);
	}
};
