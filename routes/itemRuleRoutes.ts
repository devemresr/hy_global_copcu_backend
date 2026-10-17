import { Router } from 'express';
import { requireAuth } from '../controllers/auth.helper';
import { listItemRules, saveItemRules } from '../controllers/itemRules.controller';
import { validateBody } from '../middleware/validateBody.middleware';
import { saveItemRulesSchema } from '../schemas/itemRule.schema';
import { ITEM_RULE_ROUTES } from './routes.constant';

export default function itemRuleRoutes() {
	const router = Router();
	router.get(ITEM_RULE_ROUTES.LIST, ...requireAuth(), listItemRules);
	router.put(ITEM_RULE_ROUTES.SAVE, ...requireAuth(), validateBody(saveItemRulesSchema), saveItemRules);
	return router;
}
