import { Router } from 'express';
import login from '../controllers/login.controller';
import { AUTH_ROUTES } from './routes.constant';
import refresh from '../controllers/refresh.controller';
import { loginLimiter } from '../middleware/rateLimit.middleware';
import { validateBody } from '../middleware/validateBody.middleware';
import { loginSchema } from '../schemas/auth.schema';
const router = () => {
	const router = Router();

	router.post(AUTH_ROUTES.LOGIN, loginLimiter, validateBody(loginSchema), login);
	// router.post(AUTH_ROUTES.LOGOUT, logout());

	router.post(AUTH_ROUTES.REFRESH, refresh);
	return router;
};

export default router;
