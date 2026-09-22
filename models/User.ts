import mongoose, { Types } from 'mongoose';
import {
	ADMIN_ROLES,
	ALL_ADMIN_ROLES,
	ALL_PERMISSIONS,
} from '../constants/permissions.constant';
import type { AdminRole, Permission } from '../constants/permissions.constant';
export type DocumentWithTimestamps<T> = T & {
	createdAt: Date;
	updatedAt: Date;
};
const { Schema } = mongoose;

const userSchema = new Schema<TimeStampedUser>(
	{
		password: { type: String, required: true, select: false },
		username: { type: String, required: true, unique: true },
		email: { type: String, required: true, unique: true },
		avatarUrl: { type: String, required: false },
		role: {
			type: String,
			enum: ALL_ADMIN_ROLES,
			required: true,
			default: ADMIN_ROLES.ADMIN,
		},
		// Only consulted when role is 'admin' - a head admin holds every
		// permission implicitly and never needs entries here.
		permissions: {
			type: [String],
			enum: ALL_PERMISSIONS,
			default: [],
		},
	},
	{ timestamps: true, collection: 'users' },
);

export const User = mongoose.model<TimeStampedUser>('User', userSchema);

export type UserData = {
	password: string;
	email: string;
	avatarUrl?: string | null;
	username: string;
	role: AdminRole;
	permissions: Permission[];
};

export type TimeStampedUser = DocumentWithTimestamps<UserData> & {
	_id: Types.ObjectId;
};
export type PublicUser = Omit<UserData, 'password' | '__v'> & {
	_id: Types.ObjectId;
};
