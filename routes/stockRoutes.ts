import { Router } from 'express';
import { requireAuth } from '../controllers/auth.helper';
import {
	getStockConversions,
	postStockConversion,
} from '../controllers/stockConversion.controller';
import { stockConversionSchema } from '../schemas/stockConversion.schema';
import {
	getStock,
	postSale,
	postPurchaseWarnings,
} from '../controllers/stock.controller';
import { STOCK_ROUTES } from './routes.constant';
import { validateBody } from '../middleware/validateBody.middleware';
import {
	purchaseWarningSchema,
	stockSaleSchema,
} from '../schemas/stock.schema';

export default function stockRoutes() {
	const router = Router();
	router.get('/stock/conversions', ...requireAuth(), getStockConversions);
	router.post(
		'/stock/conversions',
		...requireAuth(),
		validateBody(stockConversionSchema),
		postStockConversion,
	);
	router.get(STOCK_ROUTES.LIST, ...requireAuth(), getStock);
	router.post(
		STOCK_ROUTES.SALES,
		...requireAuth(),
		validateBody(stockSaleSchema),
		postSale,
	);
	router.post(
		STOCK_ROUTES.WARNINGS,
		...requireAuth(),
		validateBody(purchaseWarningSchema),
		postPurchaseWarnings,
	);
	return router;
}
