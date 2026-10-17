/**
 * Inserts a prefix_matches.json lookup result into the items collection and
 * records the whole insert as one bulk `items:create` log batch.
 *
 * Mapping (per result): name -> model, manufacturer -> uretici, ic_type ->
 * bellekTipi (upper-cased), ram -> ram, match_type -> eslesmeTuru, the IC id
 * it was looked up under -> sorgulananDeger, storage -> depolama +
 * depolamaBirimi. Unreadable sizes (e.g. "32 eMMC") are excluded.
 *
 * Rules:
 * - Candidates come from `items` and every `mismatchedResults` group;
 *   `noResultIcIDs` are only reported, there's nothing but an id to insert.
 * - Only readable storage sizes >= MIN_STORAGE_GB (currently 8 GB) qualify.
 * - Model matching ignores case and dashes, soft-deleted DB rows excluded.
 *   A model repeated in the file is inserted once, first eligible row wins.
 * - Every doc is checked against createItemSchema before anything is written.
 *
 * Design choices:
 * - Goes through the server's own Item/LogEvent models and withVersionBump
 *   instead of raw collection writes (as bulkwrite-missing-items.ts did), so
 *   Mongoose validation, timestamps and version stamping match a normal
 *   POST /items exactly.
 * - The log entries share one batchId, so the admin log folds them into a
 *   single bulk card, same as a bulk update.
 *
 * DRY RUN by default - nothing is written unless --run is passed:
 *   cd server
 *   npx tsx --env-file=.env.dev local/insertPrefixMatches.ts "<path to json>"
 *   npx tsx --env-file=.env.dev local/insertPrefixMatches.ts "<path to json>" --run [--admin <username>]
 *   npx tsx local/insertPrefixMatches.ts --offline
 * Defaults to local/prefix_matches (3).json. --offline is dry-run only and
 * skips the DB lookup; --run always rechecks active DB models before writing.
 * Writes <input basename>.preview.json alongside the input.
 * Restart the backend after --run: it keeps the global version in memory.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import mongoose from 'mongoose';
import { nanoid } from 'nanoid';
import { Item } from '../models/Item';
import { User } from '../models/User';
import { LogEvent, LOG_ACTIONS, LOG_ENTITY_TYPES } from '../models/LogEvent';
import { ADMIN_ROLES } from '../constants/permissions.constant';
import {
	createItemSchema,
	EDITABLE_ITEM_FIELDS,
	type CreateItemInput,
} from '../schemas/item.schema';
import { parseSize, parseSizeGb } from '../../frontend/src/app/helpers/inventoryPageHelpers/memorySize.helper';
import { normalizeAndFilterRows, MIN_STORAGE_GB } from '../../frontend/src/app/helpers/inventoryPageHelpers/rowNormalize.helper';
import { normalizeModelKey } from '../../frontend/src/app/helpers/inventoryPageHelpers/displaySafe.helper';

const matchResultSchema = z.object({
	name: z.string(),
	manufacturer: z.string().nullable(),
	ic_type: z.string().nullable(),
	storage: z.string().nullable(),
	ram: z.string().nullable(),
	match_type: z.string().nullable(),
	queried_as: z.string().optional(),
});
type MatchResult = z.infer<typeof matchResultSchema>;
const prefixMatchesSchema = z.object({
	items: z.array(matchResultSchema),
	mismatchedIcIDs: z.array(z.string()),
	mismatchedResults: z.array(z.array(matchResultSchema)),
	noResultIcIDs: z.array(z.string()),
});

const args = process.argv.slice(2);
const RUN = args.includes('--run');
const OFFLINE = args.includes('--offline');
if (RUN && OFFLINE) throw new Error('--offline cannot be combined with --run');
for (const arg of args.filter((arg) => arg.startsWith('--'))) {
	if (!['--run', '--offline', '--admin'].includes(arg)) {
		throw new Error(`Unknown option: ${arg}`);
	}
}
const adminFlag = args.indexOf('--admin');
const ADMIN_USERNAME = adminFlag >= 0 ? args[adminFlag + 1] : null;
if (adminFlag >= 0 && (!ADMIN_USERNAME || ADMIN_USERNAME.startsWith('--'))) {
	throw new Error('--admin requires a username');
}
const inputPaths = args.filter(
	(arg, i) => !arg.startsWith('--') && args[i - 1] !== '--admin',
);
if (inputPaths.length > 1) throw new Error('Pass only one input JSON path');
const inputPath = resolve(inputPaths[0] ?? fileURLToPath(new URL('./prefix_matches (3).json', import.meta.url)));
const previewPath = join(dirname(inputPath), `${basename(inputPath, '.json')}.preview.json`);

const norm = (s: string) => normalizeModelKey(s.trim());
const orNull = (s: string | null | undefined) => s?.trim() || null;

function toDoc(result: MatchResult, queriedAs: string) {
	const parsed = parseSize(result.storage);
	// depolamaBirimi only allows GB/TB
	const storage = parsed?.unit === 'MB' ? null : parsed;
	return {
		model: result.name.trim(),
		uretici: orNull(result.manufacturer),
		bellekTipi: orNull(result.ic_type)?.toUpperCase() ?? null,
		ram: orNull(result.ram),
		eslesmeTuru: orNull(result.match_type),
		sorgulananDeger: queriedAs.trim(),
		depolama: storage?.value ?? null,
		depolamaBirimi: storage?.unit ?? 'GB',
		fiyat: null,
		paraBirimi: 'TRY' as const,
	};
}

async function main(): Promise<void> {
	const input = prefixMatchesSchema.parse(JSON.parse(readFileSync(inputPath, 'utf8')));
	if (input.mismatchedIcIDs.length !== input.mismatchedResults.length) {
		throw new Error('mismatchedIcIDs and mismatchedResults are not the same length');
	}

	const sourceRows = [
		...input.items.map((r) => ({ result: r, queriedAs: r.queried_as ?? r.name })),
		...input.mismatchedResults.flatMap((list, i) =>
			list.map((r) => ({ result: r, queriedAs: input.mismatchedIcIDs[i] })),
		),
	];
	// Reuse the upload pipeline's size parser, minimum and normalization.
	const eligibleRows = normalizeAndFilterRows(sourceRows.map((row, sourceIndex) => ({
		sourceIndex,
		Depoloma: row.result.storage,
	})));
	const candidates = eligibleRows.map((row) => {
		const { result, queriedAs } = sourceRows[Number(row.sourceIndex)];
		return toDoc({ ...result, storage: String(row.Depoloma) }, queriedAs);
	});
	const skippedStorage = sourceRows.flatMap(({ result }) => {
		const sizeGb = parseSizeGb(result.storage);
		return sizeGb === null || sizeGb < MIN_STORAGE_GB
			? [{ model: result.name, storage: result.storage, reason: sizeGb === null ? 'unreadableStorage' : 'belowMinimumStorage' }]
			: [];
	});

	const existing = new Set<string>();
	if (!OFFLINE) {
		// Suppress Mongoose's automatic index/collection writes during dry runs.
		mongoose.set('autoIndex', false);
		mongoose.set('autoCreate', false);
		const { connectDB } = await import('../config/db');
		await connectDB();
		for (const item of await Item.find({ deletedAt: null }).select('model').lean()) {
			existing.add(norm(item.model));
		}
	}

	const skippedExisting: string[] = [];
	const skippedDuplicate: string[] = [];
	const invalid: { model: string; error: string }[] = [];
	const seen = new Set<string>();
	const toInsert: (ReturnType<typeof toDoc>)[] = [];

	for (const doc of candidates) {
		const key = norm(doc.model);
		if (existing.has(key)) {
			skippedExisting.push(doc.model);
			continue;
		}
		if (seen.has(key)) {
			skippedDuplicate.push(doc.model);
			continue;
		}
		const parsed = createItemSchema.safeParse(doc);
		if (!parsed.success) {
			invalid.push({ model: doc.model, error: parsed.error.issues[0].message });
			continue;
		}
		seen.add(key);
		toInsert.push(doc);
	}

	const summary = {
		mode: RUN ? 'run' : 'dry-run',
		inputPath,
		dbChecked: !OFFLINE,
		minimumStorageGb: MIN_STORAGE_GB,
		candidates: sourceRows.length,
		eligibleByStorage: candidates.length,
		skippedStorage: skippedStorage.length,
		toInsert: toInsert.length,
		skippedExisting: [...new Set(skippedExisting)].length,
		skippedDuplicateInFile: [...new Set(skippedDuplicate)].length,
		skippedDuplicateRows: skippedDuplicate.length,
		invalid,
		noResultIcIDs: input.noResultIcIDs,
	};
	writeFileSync(previewPath, JSON.stringify({
		...summary,
		skippedStorageRows: skippedStorage,
		skippedExistingModels: [...new Set(skippedExisting)],
		skippedDuplicateModels: [...new Set(skippedDuplicate)],
		docs: toInsert,
	}, null, 2));
	console.log(JSON.stringify(summary, null, 2));
	console.log(`Preview: ${previewPath}`);

	if (!RUN || toInsert.length === 0) {
		console.log(
			RUN ? 'Nothing to insert.' : `Dry run - no database writes. ${OFFLINE ? 'Existing DB models have not been checked. ' : ''}Review the preview, then pass --run to insert.`,
		);
		return;
	}

	const admin = await User.findOne(
		ADMIN_USERNAME ? { username: ADMIN_USERNAME } : { role: ADMIN_ROLES.HEAD_ADMIN },
	).lean();
	if (!admin) {
		throw new Error(`Admin not found: ${ADMIN_USERNAME ?? '(first head admin)'}`);
	}

	const { initVersionState, withVersionBump } = await import('../services/sync/version.service');
	await initVersionState();
	const { inserted, version } = await withVersionBump(async (version) => {
		const inserted = await Item.insertMany(
			toInsert.map((doc) => ({ ...doc, version, deletedAt: null })),
		);
		return { inserted, version };
	});

	// Same per-row shape as createItem's log entry, one batchId for the lot.
	const batchId = nanoid();
	await LogEvent.insertMany(
		inserted.map((item) => ({
			adminId: admin._id,
			adminUsername: admin.username,
			action: LOG_ACTIONS.ITEMS_CREATE,
			entityType: LOG_ENTITY_TYPES.ITEM,
			entityId: item._id,
			entityKey: item.model,
			fields: EDITABLE_ITEM_FIELDS.map((field) => ({
				field,
				previousValue: null,
				newValue: (item[field as keyof CreateItemInput] as string | number | null) ?? null,
			})),
			batchId,
			version,
		})),
	);

	console.log({ inserted: inserted.length, version, batchId, admin: admin.username });
}

main()
	.catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	})
	.finally(() => mongoose.disconnect());
