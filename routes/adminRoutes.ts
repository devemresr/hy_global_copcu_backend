import { Router } from 'express';
import {
	listAdmins,
	createAdmin,
	updateAdminPermissions,
} from '../controllers/admins.controller';
import { requireAuth } from '../controllers/auth.helper';
import { requireHeadAdmin } from '../middleware/authorize.middleware';
import { validateBody } from '../middleware/validateBody.middleware';
import {
	createAdminSchema,
	updateAdminPermissionsSchema,
} from '../schemas/admin.schema';
import { ADMIN_ROUTES } from './routes.constant';
import { sendAdminTestEmail } from '../controllers/email.controller';
import { testEmailSchema } from '../schemas/email.schema';
import { rateLimit } from 'express-rate-limit';
import { requireUserId } from '../controllers/auth.helper';
import {
	listReportSchedules,
	saveReportSchedule,
	deleteReportSchedule,
	sendReportScheduleNow,
} from '../controllers/reportSchedule.controller';
import env from '../config/env';
import {
	getInventorySnapshotSchedule,
	updateInventorySnapshotSchedule,
	refreshInventorySnapshotNow,
} from '../controllers/inventorySnapshot.controller';
import { inventorySnapshotScheduleSchema } from '../schemas/inventorySnapshot.schema';
import {
	getEmailPreferences,
	saveEmailPreferences,
	emailPreferencesSchema,
} from '../controllers/emailPreferences.controller';

const emailLimiter = rateLimit({
	windowMs: 60_000,
	limit: 5,
	keyGenerator: (req) => requireUserId(req),
	standardHeaders: true,
	legacyHeaders: false,
	message: {
		success: false,
		message: 'Çok fazla e-posta isteği. Bir dakika sonra tekrar deneyin.',
	},
});

const router = () => {
	const router = Router();
	router.get(
		'/admins/inventory-snapshot',
		...requireAuth(),
		requireHeadAdmin,
		getInventorySnapshotSchedule,
	);
	router.put(
		'/admins/inventory-snapshot',
		...requireAuth(),
		requireHeadAdmin,
		validateBody(inventorySnapshotScheduleSchema),
		updateInventorySnapshotSchedule,
	);
	router.get(
		'/admins/email-preferences',
		...requireAuth(),
		requireHeadAdmin,
		getEmailPreferences,
	);
	router.put(
		'/admins/email-preferences',
		...requireAuth(),
		requireHeadAdmin,
		validateBody(emailPreferencesSchema),
		saveEmailPreferences,
	);
	if (env.NODE_ENV === 'development') {
		router.post(
			'/admins/inventory-snapshot/refresh-now',
			...requireAuth(),
			requireHeadAdmin,
			emailLimiter,
			refreshInventorySnapshotNow,
		);
		router.post(
			'/admins/report-schedules/:id/send-now',
			...requireAuth(),
			requireHeadAdmin,
			emailLimiter,
			sendReportScheduleNow,
		);
	}
	router.get(
		'/admins/report-schedules',
		...requireAuth(),
		requireHeadAdmin,
		listReportSchedules,
	);
	router.post(
		'/admins/report-schedules',
		...requireAuth(),
		requireHeadAdmin,
		saveReportSchedule,
	);
	router.put(
		'/admins/report-schedules/:id',
		...requireAuth(),
		requireHeadAdmin,
		saveReportSchedule,
	);
	router.delete(
		'/admins/report-schedules/:id',
		...requireAuth(),
		requireHeadAdmin,
		deleteReportSchedule,
	);
	router.post(
		ADMIN_ROUTES.TEST_EMAIL,
		...requireAuth(),
		requireHeadAdmin,
		validateBody(testEmailSchema),
		emailLimiter,
		sendAdminTestEmail,
	);

	router.get(ADMIN_ROUTES.LIST, ...requireAuth(), requireHeadAdmin, listAdmins);
	router.post(
		ADMIN_ROUTES.CREATE,
		...requireAuth(),
		requireHeadAdmin,
		validateBody(createAdminSchema),
		createAdmin,
	);
	router.patch(
		ADMIN_ROUTES.UPDATE_PERMISSIONS,
		...requireAuth(),
		requireHeadAdmin,
		validateBody(updateAdminPermissionsSchema),
		updateAdminPermissions,
	);

	return router;
};

export default router;
