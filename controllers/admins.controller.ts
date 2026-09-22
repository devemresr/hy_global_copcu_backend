import * as bcrypt from 'bcryptjs';
import type { Request, Response } from 'express';
import { User } from '../models/User';
import type { PublicUser } from '../models/User';
import { ADMIN_ROLES, ALL_PERMISSIONS } from '../constants/permissions.constant';
import type { Permission } from '../constants/permissions.constant';
import { SALT_ROUNDS } from './login.controller';
import { NotFoundError, ValidationError } from '../errors/HttpError';
import { handleHttpError } from '../errors/handleHttpError';
import logger from '../util/logger';

const log = logger.child({ controller: 'admins' });

function isValidPermissionList(value: unknown): value is Permission[] {
	return (
		Array.isArray(value) &&
		value.every((p) => (ALL_PERMISSIONS as string[]).includes(p))
	);
}

export const listAdmins = async (_req: Request, res: Response): Promise<void> => {
	try {
		const admins = await User.find()
			.select('-password -__v')
			.lean<PublicUser[]>();
		res.status(200).json({ success: true, admins });
	} catch (error) {
		handleHttpError(error, res, log);
	}
};

// Only a head admin can call this - it's the only way an admin account gets
// created today (mirrors seed.ts: there's still no self-registration).
export const createAdmin = async (req: Request, res: Response): Promise<void> => {
	try {
		const { email, username, password, permissions } = req.body;

		if (
			typeof email !== 'string' ||
			typeof username !== 'string' ||
			typeof password !== 'string' ||
			!email ||
			!username ||
			!password
		) {
			throw new ValidationError('email, username and password are required');
		}

		const grantedPermissions = permissions ?? [];
		if (!isValidPermissionList(grantedPermissions)) {
			throw new ValidationError('Invalid permissions');
		}

		const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
		const admin = await User.create({
			email: email.toLowerCase().trim(),
			username,
			password: hashedPassword,
			role: ADMIN_ROLES.ADMIN,
			permissions: grantedPermissions,
		});

		const { password: _password, ...publicAdmin } = admin.toObject();
		res.status(201).json({ success: true, admin: publicAdmin });
	} catch (error) {
		handleHttpError(error, res, log);
	}
};

export const updateAdminPermissions = async (
	req: Request,
	res: Response,
): Promise<void> => {
	const { id } = req.params;
	const scopedLog = log.child({ adminId: id });

	try {
		const { permissions } = req.body;
		if (!isValidPermissionList(permissions)) {
			throw new ValidationError('Invalid permissions');
		}

		const target = await User.findById(id).select('role').lean();
		if (!target) {
			throw new NotFoundError('Admin');
		}
		if (target.role === ADMIN_ROLES.HEAD_ADMIN) {
			throw new ValidationError("A head admin's permissions can't be changed");
		}

		const admin = await User.findByIdAndUpdate(
			id,
			{ $set: { permissions } },
			{ new: true, runValidators: true },
		)
			.select('-password -__v')
			.lean<PublicUser>();

		res.status(200).json({ success: true, admin });
	} catch (error) {
		handleHttpError(error, res, scopedLog);
	}
};
