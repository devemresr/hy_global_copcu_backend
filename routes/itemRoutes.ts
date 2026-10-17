import { Router } from 'express';
import {
	listItems,
	listItemChanges,
	createItem,
	updateItem,
	bulkUpdateItems,
	bulkDeleteItems,
	deleteItem,
} from '../controllers/items.controller';
import { requireAuth } from '../controllers/auth.helper';
import { requirePermission } from '../middleware/authorize.middleware';
import { validateBody } from '../middleware/validateBody.middleware';
import {
	createItemSchema,
	updateItemSchema,
	bulkUpdateItemsSchema,
	bulkDeleteItemsSchema,
} from '../schemas/item.schema';
import { PERMISSIONS } from '../constants/permissions.constant';
import { ITEMS_ROUTES } from './routes.constant';
import { blockPublicDuringMaintenance } from '../middleware/maintenance.middleware';

const router = () => {
	const router = Router();

	router.get(ITEMS_ROUTES.LIST, blockPublicDuringMaintenance, listItems);
	router.get(ITEMS_ROUTES.CHANGES, blockPublicDuringMaintenance, listItemChanges);
	router.post(
		ITEMS_ROUTES.CREATE,
		...requireAuth(),
		requirePermission(PERMISSIONS.ITEMS_CREATE),
		validateBody(createItemSchema),
		createItem,
	);
	// Must be registered before UPDATE - Express would otherwise match
	// PATCH /items/bulk against /items/:id first, treating "bulk" as an id.
	router.patch(
		ITEMS_ROUTES.BULK_UPDATE,
		...requireAuth(),
		requirePermission(PERMISSIONS.ITEMS_UPDATE),
		validateBody(bulkUpdateItemsSchema),
		bulkUpdateItems,
	);
	router.patch(
		ITEMS_ROUTES.UPDATE,
		...requireAuth(),
		requirePermission(PERMISSIONS.ITEMS_UPDATE),
		validateBody(updateItemSchema),
		updateItem,
	);
	// Register the static bulk path before DELETE /items/:id.
	router.delete(
		ITEMS_ROUTES.BULK_DELETE,
		...requireAuth(),
		requirePermission(PERMISSIONS.ITEMS_DELETE),
		validateBody(bulkDeleteItemsSchema),
		bulkDeleteItems,
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
