import { afterAll, beforeAll, beforeEach, inject, vi } from 'vitest';
import mongoose from 'mongoose';

// Mocks declared in a setup file apply to every test file.

// jsonwebtoken's exp has 1-second resolution, so a token signed with a
// lifetime of N seconds expires between N-1 and N seconds later - helpers.ts's
// TIMING waits account for that.
vi.mock('../services/auth/constants/jwtConstants', async (importOriginal) => ({
	...(await importOriginal<typeof import('../services/auth/constants/jwtConstants')>()),
	JWT_EXPIRE_TIMES: { ACCESSTOKEN: 1, REFRESHTOKEN: 3, SESSION_ABSOLUTE: 60 },
	ROTATION_GRACE_MS: 500,
}));

// The real login limiter (10 per 15 min) would start answering 429 mid-suite.
vi.mock('../middleware/rateLimit.middleware', () => {
	const passThrough = (_req: unknown, _res: unknown, next: () => void) => next();
	return { apiLimiter: passThrough, loginLimiter: passThrough };
});

beforeAll(async () => {
	await mongoose.connect(inject('mongoUri'));
});

beforeEach(async () => {
	await mongoose.connection.db!.dropDatabase();
	const { seedUser } = await import('./helpers');
	await seedUser();
});

afterAll(async () => {
	await mongoose.disconnect();
});
