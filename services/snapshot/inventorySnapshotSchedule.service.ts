import { randomUUID } from 'node:crypto';
import { InventorySnapshotSchedule } from '../../models/InventorySnapshotSchedule';
import {
	inventorySnapshotPath,
	writeInventorySnapshot,
} from './inventorySnapshot.service';
import logger from '../../util/logger';

const ID = 'inventory';
export const DEFAULT_SNAPSHOT_INTERVAL_MINUTES = 60;
let timer: ReturnType<typeof setInterval> | undefined;
let running: Promise<void> | undefined;
const log = logger.child({ module: 'inventorySnapshotScheduler' });
export async function readInventorySnapshotSchedule() {
	const state = await InventorySnapshotSchedule.findById(ID).lean();
	return {
		intervalMinutes:
			state?.intervalMinutes ?? DEFAULT_SNAPSHOT_INTERVAL_MINUTES,
		nextRunAt: state?.nextRunAt ?? null,
		lastExportedAt: state?.lastExportedAt ?? null,
		lastItemCount: state?.lastItemCount ?? null,
		lastError: state?.lastError ?? null,
	};
}
export async function saveInventorySnapshotInterval(
	intervalMinutes: number,
	now = new Date(),
) {
	await InventorySnapshotSchedule.updateOne(
		{ _id: ID },
		{
			$set: {
				intervalMinutes,
				nextRunAt: new Date(now.getTime() + intervalMinutes * 60_000),
			},
			$setOnInsert: {
				lastExportedAt: null,
				lastItemCount: null,
				lastError: null,
				lockedAt: null,
				claimId: null,
			},
		},
		{ upsert: true },
	);
	return readInventorySnapshotSchedule();
}
export async function runDueInventorySnapshot(
	now = new Date(),
	target = inventorySnapshotPath(),
	options: { force?: boolean; throwOnFailure?: boolean } = {},
) {
	await InventorySnapshotSchedule.updateOne(
		{ _id: ID },
		{
			$setOnInsert: {
				intervalMinutes: DEFAULT_SNAPSHOT_INTERVAL_MINUTES,
				nextRunAt: now,
			},
		},
		{ upsert: true },
	);
	const claimId = randomUUID();
	const job = await InventorySnapshotSchedule.findOneAndUpdate(
		{
			_id: ID,
			...(options.force ? {} : { nextRunAt: { $lte: now } }),
			$or: [
				{ lockedAt: null },
				{ lockedAt: { $lt: new Date(now.getTime() - 300_000) } },
			],
		},
		{ $set: { lockedAt: now, claimId } },
		{ returnDocument: 'after' },
	).lean();
	if (!job) return;
	try {
		const result = await writeInventorySnapshot(target);
		await InventorySnapshotSchedule.updateOne(
			{ _id: ID, claimId },
			[
				{
					$set: {
						lastExportedAt: result.exportedAt,
						lastItemCount: result.itemCount,
						lastError: null,
						lockedAt: null,
						claimId: null,
						nextRunAt: {
							$add: [new Date(), { $multiply: ['$intervalMinutes', 60_000] }],
						},
					},
				},
			],
			{ updatePipeline: true },
		);
		log.info({ itemCount: result.itemCount }, 'Inventory snapshot refreshed');
		return result;
	} catch (error) {
		await InventorySnapshotSchedule.updateOne(
			{ _id: ID, claimId },
			{
				$set: {
					lastError:
						'Yedek ürün listesi yenilenemedi. Son başarılı kopya korunuyor; bir dakika sonra tekrar denenecek.',
					lockedAt: null,
					claimId: null,
					nextRunAt: new Date(Date.now() + 60_000),
				},
			},
		);
		log.error(
			{ err: error },
			'Inventory snapshot refresh failed; last good copy retained',
		);
		if (options.throwOnFailure) throw error;
	}
}
function tick() {
	if (running) return running;
	running = runDueInventorySnapshot()
		.then(() => undefined)
		.catch((error) =>
			log.error({ err: error }, 'Inventory snapshot scheduler failed'),
		)
		.finally(() => {
			running = undefined;
		});
	return running;
}
export function startInventorySnapshots() {
	if (timer) return;
	timer = setInterval(() => void tick(), 30_000);
	timer.unref();
	void tick();
}
export async function stopInventorySnapshots() {
	if (timer) clearInterval(timer);
	timer = undefined;
	await running;
}
