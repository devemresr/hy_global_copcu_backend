import express from 'express';
import corsOptions from './config/corsOptions';
import credentials from './config/credentials';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { handleSanitization } from './middleware/handleSanitization.middleware';
import authRoutes from './routes/authRoutes';
import itemRoutes from './routes/itemRoutes';
import adminRoutes from './routes/adminRoutes';
import pricingRulesRoutes from './routes/pricingRulesRoutes';
import logEventRoutes from './routes/logEventRoutes';
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
app.use(adminRoutes());
app.use(pricingRulesRoutes());
app.use(logEventRoutes());

export default app;
