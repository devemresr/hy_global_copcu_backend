import { Router } from 'express';
import {
	getSiteStatus,
	updateMaintenance,
	updateNotice,
	updatePromotion,
} from '../controllers/site.controller';
import { requireAuth } from '../controllers/auth.helper';
import { requireHeadAdmin } from '../middleware/authorize.middleware';
import { validateBody } from '../middleware/validateBody.middleware';
import { updateMaintenanceSchema, updateNoticeSchema, updatePromotionSchema } from '../schemas/site.schema';
import { SITE_ROUTES } from './routes.constant';

const router = () => {
	const router = Router();

	router.get(SITE_ROUTES.STATUS, getSiteStatus);
	router.put(SITE_ROUTES.PROMOTION, ...requireAuth(), requireHeadAdmin, validateBody(updatePromotionSchema), updatePromotion);
	router.put(
		SITE_ROUTES.MAINTENANCE,
		...requireAuth(),
		requireHeadAdmin,
		validateBody(updateMaintenanceSchema),
		updateMaintenance,
	);
	router.put(
		SITE_ROUTES.NOTICE,
		...requireAuth(),
		requireHeadAdmin,
		validateBody(updateNoticeSchema),
		updateNotice,
	);

	return router;
};

export default router;
