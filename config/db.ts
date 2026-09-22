import mongoose from 'mongoose';
import env from './env';
import logger from '../util/logger';

const log = logger.child({ method: 'connectDB' });

/**
 * Called once at boot (server.ts). Cached so a second accidental call (e.g.
 * from another module) reuses the same connection instead of opening a
 * duplicate one, and clears itself on failure so a retry isn't stuck
 * replaying a rejected promise forever.
 */
let connectionPromise: Promise<typeof mongoose> | null = null;

export const connectDB = (): Promise<typeof mongoose> => {
	if (mongoose.connection.readyState === 1) {
		return Promise.resolve(mongoose);
	}

	if (!connectionPromise) {
		log.info('Connecting to MongoDB');
		connectionPromise = mongoose.connect(env.MONGODB_URI).catch((error) => {
			connectionPromise = null;
			log.error({ err: error }, 'MongoDB connection failed');
			throw error;
		});
	}

	return connectionPromise;
};
