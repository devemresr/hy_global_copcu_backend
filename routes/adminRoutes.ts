import { Router } from 'express';
import {
	listAdmins,
	createAdmin,
	updateAdminPermissions,
} from '../controllers/admins.controller';
import { requireAuth } from '../controllers/auth.helper';
import { requireHeadAdmin } from '../middleware/authorize.middleware';
import { ADMIN_ROUTES } from './routes.constant';

const router = () => {
	const router = Router();

	router.get(
		ADMIN_ROUTES.LIST,
		...requireAuth(),
		requireHeadAdmin,
		listAdmins,
	);
	router.post(
		ADMIN_ROUTES.CREATE,
		...requireAuth(),
		requireHeadAdmin,
		createAdmin,
	);
	router.patch(
		ADMIN_ROUTES.UPDATE_PERMISSIONS,
		...requireAuth(),
		requireHeadAdmin,
		updateAdminPermissions,
	);

	return router;
};

export default router;
