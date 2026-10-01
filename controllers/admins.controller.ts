import * as bcrypt from 'bcryptjs';
import type { Request, Response } from 'express';
import { User } from '../models/User';
import type { PublicUser } from '../models/User';
import { ADMIN_ROLES } from '../constants/permissions.constant';
import type {
	CreateAdminInput,
	UpdateAdminPermissionsInput,
} from '../schemas/admin.schema';
import { SALT_ROUNDS } from './login.controller';
import { NotFoundError, ValidationError } from '../errors/HttpError';
import { handleHttpError } from '../errors/handleHttpError';
import logger from '../util/logger';

export const listAdmins = async (_req: Request, res: Response): Promise<void> => {
	const log = logger.child({ method: 'listAdmins' });
	try {
		log.debug('Listing admins');
		const admins = await User.find()
			.select('-password -__v')
			.lean<PublicUser[]>();
		log.debug({ count: admins.length }, 'Admins listed');
		res.status(200).json({ success: true, admins });
	} catch (error) {
		handleHttpError(error, res, log);
	}
};

// Only a head admin can call this - it's the only way an admin account gets
// created today (mirrors seed.ts: there's still no self-registration).
export const createAdmin = async (req: Request, res: Response): Promise<void> => {
	const log = logger.child({ method: 'createAdmin' });
	try {
		const { email, username, password, permissions }: CreateAdminInput =
			req.body;
		log.debug({ email, username }, 'Creating admin');

		const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
		const admin = await User.create({
			email,
			username,
			password: hashedPassword,
			role: ADMIN_ROLES.ADMIN,
			permissions,
		});

		const { password: _password, ...publicAdmin } = admin.toObject();
		log.info(
			{ email, username, adminId: admin._id.toString() },
			'Admin created',
		);
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
	const log = logger.child({ method: 'updateAdminPermissions', adminId: id });

	try {
		const { permissions }: UpdateAdminPermissionsInput = req.body;
		log.debug({ permissions }, 'Updating admin permissions');

		const target = await User.findById(id).select('role').lean();
		if (!target) {
			log.warn('Admin not found');
			throw new NotFoundError('Admin');
		}
		if (target.role === ADMIN_ROLES.HEAD_ADMIN) {
			log.warn("Refused to change a head admin's permissions");
			throw new ValidationError("A head admin's permissions can't be changed");
		}

		const admin = await User.findByIdAndUpdate(
			id,
			{ $set: { permissions } },
			{ new: true, runValidators: true },
		)
			.select('-password -__v')
			.lean<PublicUser>();

		log.info({ permissions }, 'Admin permissions updated');
		res.status(200).json({ success: true, admin });
	} catch (error) {
		handleHttpError(error, res, log);
	}
};
