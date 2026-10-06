import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts'],
		globalSetup: ['tests/globalSetup.ts'],
		setupFiles: ['tests/setup.ts'],
		// envalid validates these once at import time, before any test code runs.
		env: {
			NODE_ENV: 'test',
			LOG_LEVEL: 'silent',
			ACCESS_TOKEN_SECRET: 'test-access-secret',
			REFRESH_TOKEN_SECRET: 'test-refresh-secret',
			// Unused - setup.ts connects mongoose to the in-memory server directly.
			MONGODB_URI: 'mongodb://unused',
		},
		// Several tests wait out real token lifetimes.
		testTimeout: 20_000,
		hookTimeout: 120_000,
		fileParallelism: false,
	},
});
