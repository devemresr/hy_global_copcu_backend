import { afterAll, beforeAll, beforeEach, expect, inject, vi } from 'vitest';
import mongoose from 'mongoose';

// Mocks declared in a setup file apply to every test file.

// Only auth tests wait for expiry and rotation. Other suites need normal
// lifetimes so a token cannot expire between requests in a multi-step test.
// JWT expiry has 1-second resolution; helpers.ts's TIMING accounts for that.
vi.mock('../services/auth/constants/jwtConstants', async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import('../services/auth/constants/jwtConstants')
		>();
	const testPath = expect.getState().testPath?.replace(/\\/g, '/');
	if (!testPath?.includes('/tests/auth/')) return actual;
	return {
		...actual,
		JWT_EXPIRE_TIMES: { ACCESSTOKEN: 1, REFRESHTOKEN: 3, SESSION_ABSOLUTE: 60 },
		ROTATION_GRACE_MS: 500,
	};
});

// The real login limiter (10 per 15 min) would start answering 429 mid-suite.
vi.mock('../middleware/rateLimit.middleware', () => {
	const passThrough = (_req: unknown, _res: unknown, next: () => void) =>
		next();
	return { apiLimiter: passThrough, loginLimiter: passThrough };
});

beforeAll(async () => {
	await mongoose.connect(inject('mongoUri'));
	// Finish automatic index builds before beforeEach drops the database.
	// Otherwise Model.init() can cache an index-build rejection for the suite.
	await Promise.all(
		Object.values(mongoose.models).map((model) => model.init()),
	);
});

beforeEach(async () => {
	await mongoose.connection.db!.dropDatabase();
	const { seedUser } = await import('./helpers');
	await seedUser();
});

afterAll(async () => {
	await mongoose.disconnect();
});
