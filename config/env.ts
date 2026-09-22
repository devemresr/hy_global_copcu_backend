import { cleanEnv, str, port } from 'envalid';

// Validates required environment variables once at process startup. Exits
// with a clear error listing everything missing/invalid instead of failing
// later, deep in a request, with a generic "X is not set" error.
const env = cleanEnv(process.env, {
	NODE_ENV: str({
		choices: ['development', 'production', 'test', 'loadTest'],
		default: 'development',
	}),
	PORT: port({ default: 3001 }),
	MONGODB_URI: str(),
	ACCESS_TOKEN_SECRET: str(),
	REFRESH_TOKEN_SECRET: str(),
	LOG_LEVEL: str({ default: 'info' }),
});

export default env;
