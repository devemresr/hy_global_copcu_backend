import { Router } from 'express';
import { listLogEvents } from '../controllers/logEvents.controller';
import { requireAuth } from '../controllers/auth.helper';
import { LOG_EVENTS_ROUTES } from './routes.constant';

const router = () => {
	const router = Router();

	router.get(LOG_EVENTS_ROUTES.LIST, ...requireAuth(), listLogEvents);

	return router;
};

export default router;
