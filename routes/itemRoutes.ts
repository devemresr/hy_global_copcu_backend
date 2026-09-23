import { Router } from 'express';
import {
	listItems,
	createItem,
	updateItem,
	deleteItem,
} from '../controllers/items.controller';
import { requireAuth } from '../controllers/auth.helper';
import { requirePermission } from '../middleware/authorize.middleware';
import { validateBody } from '../middleware/validateBody.middleware';
import { createItemSchema, updateItemSchema } from '../schemas/item.schema';
import { PERMISSIONS } from '../constants/permissions.constant';
import { ITEMS_ROUTES } from './routes.constant';

const router = () => {
	const router = Router();

	router.get(ITEMS_ROUTES.LIST, listItems);
	router.post(
		ITEMS_ROUTES.CREATE,
		...requireAuth(),
		requirePermission(PERMISSIONS.ITEMS_CREATE),
		validateBody(createItemSchema),
		createItem,
	);
	router.patch(
		ITEMS_ROUTES.UPDATE,
		...requireAuth(),
		requirePermission(PERMISSIONS.ITEMS_UPDATE),
		validateBody(updateItemSchema),
		updateItem,
	);
	router.delete(
		ITEMS_ROUTES.DELETE,
		...requireAuth(),
		requirePermission(PERMISSIONS.ITEMS_DELETE),
		deleteItem,
	);

	return router;
};

export default router;
