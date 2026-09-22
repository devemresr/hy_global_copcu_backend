import pino from 'pino';
import env from '../config/env';

const nodeEnv = env.NODE_ENV;
const isPrettyLog = nodeEnv !== 'production';

const logger = pino({
	level: env.LOG_LEVEL,

	// Pretty printing for development
	...(isPrettyLog && {
		transport: {
			target: 'pino-pretty',
			options: {
				colorize: true,
				translateTime: 'yyyy-mm-dd HH:MM:ss',
				ignore: 'pid,hostname',
				singleLine: false,
			},
		},
	}),

	...(nodeEnv === 'production' && {
		base: { pid: false, hostname: false },
		timestamp: pino.stdTimeFunctions.isoTime,
		formatters: { level: (label) => ({ level: label }) },
	}),

	// Add error serialization for better error logging
	redact: ['req.headers.authorization', 'req.headers.cookie'],
	serializers: {
		err: pino.stdSerializers.err,
	},
});

export default logger;
