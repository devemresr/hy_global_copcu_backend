import logger from '../util/logger';
import allowedOrigins from './allowedOrigins';
import env from './env';

const corsOptions = {
	origin: (
		origin: string | undefined,
		callback: (error: Error | null, allow?: boolean) => void,
	) => {
		if (isOriginAllowed(origin)) {
			callback(null, true);
		} else {
			logger.error(
				{ corsError: `${origin} isnt allowed`, allowedOrigins },
				'CORS error',
			);
			callback(new Error('not allowed by CORS'));
		}
	},
	exposedHeaders: ['ip-blocked', 'x-refreshed-token'],
	credentials: true,
	optionsSuccessStatus: 200,
};

export default corsOptions;

const isOriginAllowed = (origin?: string) => {
	if (env.NODE_ENV === 'development') return true;
	// No Origin header means a non-browser client (curl, Postman, server-to-server) - CORS doesn't apply to those.
	return !origin || allowedOrigins.includes(origin);
};
