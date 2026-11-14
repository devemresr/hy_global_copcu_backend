import express from 'express';
import type { ErrorRequestHandler } from 'express';
import { HttpError } from './errors/HttpError';
import { handleHttpError } from './errors/handleHttpError';
import logger from './util/logger';
import corsOptions from './config/corsOptions';
import credentials from './config/credentials';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { handleSanitization } from './middleware/handleSanitization.middleware';
import authRoutes from './routes/authRoutes';
import itemRoutes from './routes/itemRoutes';
import itemRuleRoutes from './routes/itemRuleRoutes';
import adminRoutes from './routes/adminRoutes';
import logEventRoutes from './routes/logEventRoutes';
import siteRoutes from './routes/siteRoutes';
import orderRoutes from './routes/orderRoutes';
import bayiRoutes from './routes/bayiRoutes';
import stockRoutes from './routes/stockRoutes';
import financeRoutes from './routes/financeRoutes';
import { apiLimiter } from './middleware/rateLimit.middleware';

const app = express();

app.use(credentials);
app.use(helmet());
app.use(express.json({ limit: '5mb' }));
app.use(handleSanitization);
app.set('trust proxy', 1);
app.use(cors(corsOptions));
app.use(cookieParser());
app.use(express.urlencoded({ extended: false }));

app.use(apiLimiter);
app.use(authRoutes());
app.use(itemRoutes());
app.use(itemRuleRoutes());
app.use(adminRoutes());
app.use(logEventRoutes());
app.use(siteRoutes());
app.use(orderRoutes());
app.use(bayiRoutes());
app.use(stockRoutes());
app.use(financeRoutes());

app.use((_req, res) => {
	res
		.status(404)
		.json({ success: false, message: 'İstenen adres bulunamadı.' });
});

// Handle parser and middleware failures before Express emits an English page.
const handleAppError: ErrorRequestHandler = (error, _req, res, next) => {
	if (res.headersSent) return next(error);
	if (error?.type === 'entity.parse.failed') {
		return handleHttpError(
			new HttpError(
				'Invalid JSON body',
				400,
				'İstek işlenemedi. Lütfen bilgileri kontrol edip tekrar deneyin.',
			),
			res,
			logger,
		);
	}
	if (error?.type === 'entity.too.large') {
		return handleHttpError(
			new HttpError(
				'Request body too large',
				413,
				'Gönderilen veri izin verilen boyutu aşıyor.',
			),
			res,
			logger,
		);
	}
	handleHttpError(error, res, logger);
};
app.use(handleAppError);

export default app;
