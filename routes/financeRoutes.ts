import { Router } from 'express';
import { requireAuth } from '../controllers/auth.helper';
import {
	createCategory,
	createEntry,
	getFinance,
	voidEntry,
} from '../controllers/finance.controller';

export default function financeRoutes() {
	const router = Router();
	router.get('/finance', ...requireAuth(), getFinance);
	router.post('/finance/categories', ...requireAuth(), createCategory);
	router.post('/finance/entries', ...requireAuth(), createEntry);
	router.delete('/finance/entries/:id', ...requireAuth(), voidEntry);
	return router;
}
