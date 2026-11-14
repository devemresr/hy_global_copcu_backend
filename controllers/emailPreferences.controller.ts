import type { Request, Response } from 'express';
import { z } from '../util/zodTurkish';
import { EmailPreferences } from '../models/EmailPreferences';
import { TransactionEmail } from '../models/TransactionEmail';
import { readEmailPreferences } from '../services/email/emailPreferences.service';
import { handleHttpError } from '../errors/handleHttpError';
import logger from '../util/logger';
export const emailPreferencesSchema = z
	.object({
		purchase: z.boolean(),
		sale: z.boolean(),
		conversion: z.boolean(),
		financeCreate: z.boolean(),
		financeVoid: z.boolean(),
	})
	.strict();
export async function getEmailPreferences(_req: Request, res: Response) {
	try {
		res.json({ preferences: await readEmailPreferences() });
	} catch (error) {
		handleHttpError(error, res, logger);
	}
}
export async function saveEmailPreferences(req: Request, res: Response) {
	try {
		const input = emailPreferencesSchema.parse(req.body);
		await EmailPreferences.updateOne(
			{ _id: 'automatic' },
			{ $set: input },
			{ upsert: true },
		);
		const disabled = Object.entries({
			purchase: input.purchase,
			sale: input.sale,
			conversion: input.conversion,
			'finance-create': input.financeCreate,
			'finance-void': input.financeVoid,
		})
			.filter(([, enabled]) => !enabled)
			.map(([kind]) => kind);
		if (disabled.length)
			await TransactionEmail.updateMany(
				{ status: 'pending', 'receipt.kind': { $in: disabled } },
				{ $set: { status: 'cancelled', lockedAt: null } },
			);
		res.json({ preferences: input });
	} catch (error) {
		handleHttpError(error, res, logger);
	}
}
