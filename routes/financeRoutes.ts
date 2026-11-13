import { Router } from 'express';
import { requireAuth } from '../controllers/auth.helper';
import {
	createCategory,
	updateCategory,
	createInvestor,
	updateInvestor,
	getInvestors,
	createEntry,
	getFinance,
	voidEntry,
} from '../controllers/finance.controller';

export default function financeRoutes() {
	const router = Router();
	router.get('/finance/investors', ...requireAuth(), getInvestors);
	router.post('/finance/investors', ...requireAuth(), createInvestor);
	router.put('/finance/investors/:id', ...requireAuth(), updateInvestor);
	router.get('/finance', ...requireAuth(), getFinance);
	router.post('/finance/categories', ...requireAuth(), createCategory);
	router.put('/finance/categories/:id', ...requireAuth(), updateCategory);
	router.post('/finance/entries', ...requireAuth(), createEntry);
	router.delete('/finance/entries/:id', ...requireAuth(), voidEntry);
	return router;
}
