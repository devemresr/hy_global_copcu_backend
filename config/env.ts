import { bool, cleanEnv, str, port } from 'envalid';

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
	SMTP_HOST: str({ default: '' }),
	SMTP_PORT: port({ default: 465 }),
	SMTP_SECURE: bool({ default: true }),
	SMTP_USER: str({ default: '' }),
	SMTP_PASSWORD: str({ default: '' }),
	SMTP_FROM: str({ default: '' }),
	TRANSACTION_EMAIL_TO: str({ default: '' }),
	UMAMI_BASE_URL: str({ default: '' }),
	UMAMI_WEBSITE_ID: str({ default: '' }),
	UMAMI_API_TOKEN: str({ default: '' }),
	UMAMI_USERNAME: str({ default: '' }),
	UMAMI_PASSWORD: str({ default: '' }),
	UMAMI_API_VERSION: str({ choices: ['2', '3'], default: '2' }),
});

export default env;
