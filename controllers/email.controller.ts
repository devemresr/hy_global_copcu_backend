import type { Request, Response } from 'express';
import { sendTestEmail } from '../services/email/emailSender.service';
import { requireUserId } from './auth.helper';
import { handleHttpError } from '../errors/handleHttpError';
import logger from '../util/logger';

export async function sendAdminTestEmail(
	req: Request,
	res: Response,
): Promise<void> {
	const startedAt = Date.now();
	const log = logger.child({
		method: 'sendAdminTestEmail',
		adminId: requireUserId(req),
	});
	try {
		await sendTestEmail(req.body.to);
		log.info(
			{ status: 200, durationMs: Date.now() - startedAt },
			'Test email accepted by SMTP server',
		);
		res.status(200).json({ success: true });
	} catch (error) {
		handleHttpError(error, res, log);
	}
}
