import type { Request, Response } from 'express';
import { inventorySnapshotScheduleSchema } from '../schemas/inventorySnapshot.schema';
import {
	readInventorySnapshotSchedule,
	saveInventorySnapshotInterval,
	runDueInventorySnapshot,
} from '../services/snapshot/inventorySnapshotSchedule.service';
import { handleHttpError } from '../errors/handleHttpError';
import logger from '../util/logger';
import env from '../config/env';
import { ConflictError, NotFoundError } from '../errors/HttpError';
export async function refreshInventorySnapshotNow(
	_req: Request,
	res: Response,
) {
	try {
		if (env.NODE_ENV !== 'development') throw new NotFoundError('İşlem');
		const result = await runDueInventorySnapshot(new Date(), undefined, {
			force: true,
			throwOnFailure: true,
		});
		if (!result)
			throw new ConflictError(
				'Yedek ürün listesi şu anda yenileniyor. Tamamlandıktan sonra tekrar deneyin.',
			);
		res.json({ schedule: await readInventorySnapshotSchedule() });
	} catch (error) {
		handleHttpError(error, res, logger);
	}
}
export async function getInventorySnapshotSchedule(
	_req: Request,
	res: Response,
) {
	try {
		res.json({ schedule: await readInventorySnapshotSchedule() });
	} catch (error) {
		handleHttpError(error, res, logger);
	}
}
export async function updateInventorySnapshotSchedule(
	req: Request,
	res: Response,
) {
	try {
		const { intervalMinutes } = inventorySnapshotScheduleSchema.parse(req.body);
		res.json({
			schedule: await saveInventorySnapshotInterval(intervalMinutes),
		});
	} catch (error) {
		handleHttpError(error, res, logger);
	}
}
