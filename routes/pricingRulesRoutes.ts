import { Router } from 'express';
import {
	listPricingRules,
	addPricingRule,
	editPricingRule,
	deletePricingRule,
} from '../controllers/pricingRules.controller';
import { requireAuth } from '../controllers/auth.helper';
import { requirePermission } from '../middleware/authorize.middleware';
import { ACTIONS } from '../constants/permissions.constant';
import { PRICING_RULES_ROUTES } from './routes.constant';

const router = () => {
	const router = Router();

	router.get(PRICING_RULES_ROUTES.LIST, ...requireAuth(), listPricingRules);
	router.post(
		PRICING_RULES_ROUTES.CREATE,
		...requireAuth(),
		requirePermission(ACTIONS.ITEMS_ADD_RULE),
		addPricingRule,
	);
	router.patch(
		PRICING_RULES_ROUTES.UPDATE,
		...requireAuth(),
		requirePermission(ACTIONS.ITEMS_EDIT_RULE),
		editPricingRule,
	);
	router.delete(
		PRICING_RULES_ROUTES.DELETE,
		...requireAuth(),
		requirePermission(ACTIONS.ITEMS_DELETE_RULE),
		deletePricingRule,
	);

	return router;
};

export default router;
