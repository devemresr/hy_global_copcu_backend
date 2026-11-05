import { Router } from 'express';
import { requireAuth } from '../controllers/auth.helper';
import {
	createBayi,
	listBayiler,
	updateBayi,
} from '../controllers/bayiler.controller';
import { BAYI_ROUTES } from './routes.constant';

export default function bayiRoutes() {
	const router = Router();
	router.get(BAYI_ROUTES.LIST, ...requireAuth(), listBayiler);
	router.post(BAYI_ROUTES.CREATE, ...requireAuth(), createBayi);
	router.patch(BAYI_ROUTES.UPDATE, ...requireAuth(), updateBayi);
	return router;
}
