/**
 * Global data version + site settings (maintenance, page notice).
 *
 * Every item write is stamped with a version taken from one global counter,
 * so "what changed since N" is a single `version > N` query and clients only
 * ever track one number.
 *
 * Design choices:
 * - Writes are serialized in-process (withVersionBump) and the counter is
 *   only advanced after the write has finished. Without that, two
 *   concurrent writes could finish out of order (v11 lands before v10), a
 *   client could see 11, and v10 would never be fetched. Mongo
 *   transactions would also solve it but need a replica set; this server
 *   already assumes a single process (see util/queryCache.ts), and admin
 *   writes are rare, so a lock costs nothing.
 * - The committed version and maintenance state live in memory so
 *   GET /site/status never touches Mongo - it's polled by every visitor.
 *   They're persisted to the app_state document on every change and
 *   reloaded at boot.
 */
import { AppState, APP_STATE_ID } from '../../models/AppState';
import type {
	MaintenanceState,
	NoticeState,
	Schedule,
} from '../../models/AppState';
import { Item } from '../../models/Item';
import logger from '../../util/logger';

const log = logger.child({ service: 'version' });

const DEFAULT_MAINTENANCE: MaintenanceState = {
	enabled: false,
	from: null,
	until: null,
	message: null,
};

const DEFAULT_NOTICE: NoticeState = {
	enabled: false,
	from: null,
	until: null,
	message: null,
	type: 'info',
	pages: [],
	dismissible: true,
};

let committedVersion = 0;
let maintenance = DEFAULT_MAINTENANCE;
let notice = DEFAULT_NOTICE;
let writeQueue: Promise<unknown> = Promise.resolve();

export async function initVersionState(): Promise<void> {
	// Items from before versioning existed start at 0.
	await Item.updateMany(
		{ version: { $exists: false } },
		{ $set: { version: 0, deletedAt: null } },
	);

	const [state, newestItem] = await Promise.all([
		AppState.findById(APP_STATE_ID).lean(),
		Item.findOne().sort({ version: -1 }).select('version').lean(),
	]);

	// The max covers a crash between an item write and the counter save.
	committedVersion = Math.max(state?.version ?? 0, newestItem?.version ?? 0);
	// Spread over defaults so fields added later get a value.
	maintenance = { ...DEFAULT_MAINTENANCE, ...state?.maintenance };
	notice = { ...DEFAULT_NOTICE, ...state?.notice };

	await AppState.updateOne(
		{ _id: APP_STATE_ID },
		{ $set: { version: committedVersion, maintenance, notice } },
		{ upsert: true },
	);
	log.info({ version: committedVersion }, 'Version state loaded');
}

export function getVersion(): number {
	return committedVersion;
}

export function getMaintenance(): MaintenanceState {
	return maintenance;
}

export function getNotice(): NoticeState {
	return notice;
}

export function isScheduleActive(schedule: Schedule, now = new Date()): boolean {
	return (
		schedule.enabled &&
		(!schedule.from || schedule.from <= now) &&
		(!schedule.until || schedule.until > now)
	);
}

export function isMaintenanceActive(now = new Date()): boolean {
	return isScheduleActive(maintenance, now);
}

/**
 * Runs `write` with the next version number, one write at a time. The
 * counter advances even if `write` throws, since a failed updateMany may
 * still have changed some rows - an extra empty version is harmless.
 */
export function withVersionBump<T>(
	write: (version: number) => Promise<T>,
): Promise<T> {
	const run = writeQueue.then(async () => {
		const next = committedVersion + 1;
		try {
			return await write(next);
		} finally {
			await AppState.updateOne(
				{ _id: APP_STATE_ID },
				{ $max: { version: next } },
				{ upsert: true },
			);
			committedVersion = next;
		}
	});
	writeQueue = run.catch(() => undefined);
	return run;
}

// Both setters bump the version, which changes the status ETag, so pollers
// pick the new state up on their next check.
export function setMaintenance(next: MaintenanceState): Promise<MaintenanceState> {
	return withVersionBump(async () => {
		await AppState.updateOne(
			{ _id: APP_STATE_ID },
			{ $set: { maintenance: next } },
			{ upsert: true },
		);
		maintenance = next;
		return next;
	});
}

export function setNotice(next: NoticeState): Promise<NoticeState> {
	return withVersionBump(async () => {
		await AppState.updateOne(
			{ _id: APP_STATE_ID },
			{ $set: { notice: next } },
			{ upsert: true },
		);
		notice = next;
		return next;
	});
}
