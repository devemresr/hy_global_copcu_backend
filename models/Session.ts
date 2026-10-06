import mongoose, { Types } from 'mongoose';

const { Schema } = mongoose;

// One document per login. The refresh token carries this _id (sid) plus a jti;
// only currentJti may rotate, so a replayed old token is detectable.
export type SessionData = {
	_id: string;
	userId: Types.ObjectId;
	currentJti: string;
	previousJti: string | null;
	rotatedAt: Date | null;
	// Absolute cap - see JWT_EXPIRE_TIMES.SESSION_ABSOLUTE.
	expiresAt: Date;
};

const sessionSchema = new Schema<SessionData>(
	{
		_id: { type: String, required: true },
		userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
		currentJti: { type: String, required: true },
		previousJti: { type: String, default: null },
		rotatedAt: { type: Date, default: null },
		// TTL index - Mongo deletes the document once expiresAt passes.
		expiresAt: { type: Date, required: true, expires: 0 },
	},
	{ timestamps: true, collection: 'sessions' },
);

export const Session = mongoose.model<SessionData>('Session', sessionSchema);
