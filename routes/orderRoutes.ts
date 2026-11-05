import { Router } from 'express';
import { requireAuth } from '../controllers/auth.helper';
import {
	createOrder,
	getOrderPricing,
	listOrders,
} from '../controllers/orders.controller';
import { validateBody } from '../middleware/validateBody.middleware';
import { createOrderSchema } from '../schemas/order.schema';
import { ORDER_ROUTES } from './routes.constant';

export default function orderRoutes() {
	const router = Router();
	router.get(ORDER_ROUTES.PRICING, ...requireAuth(), getOrderPricing);
	router.post(
		ORDER_ROUTES.CREATE,
		...requireAuth(),
		validateBody(createOrderSchema),
		createOrder,
	);
	router.get(ORDER_ROUTES.LIST, ...requireAuth(), listOrders);
	router.post(ORDER_ROUTES.REPORT, ...requireAuth(), listOrders);
	return router;
}
