/**
 * Checks every model in rawdata13.10/rawData13.10.xlsx (Sheet1 "Model" and
 * sheet2 "model") against the items collection. Read-only.
 *
 * Dedup: models are cleaned like parseRawData1310.ts (trimmed, non-ASCII
 * notes stripped) and merged on normalizeModelKey - case and dashes ignored -
 * across both sheets, so "08EMCP08-NL3DT227" and "08emcp08nl3dt227" are one
 * model with two spellings.
 *
 * Size: Sheet1 from rawData (parseRawData), sheet2 from "bellek". A model
 * listed with several sizes takes the biggest and is flagged sizeConflict.
 *
 * Each model lands in exactly one bucket, checked in this order:
 *   existing          an active item has one of its spellings
 *   deleted           only a soft-deleted item has it
 *   dashMatch         an active item matches once case/dashes are ignored
 *   missing           not in the DB, size >= MIN_STORAGE_GB
 *   missingUnder8Gb   not in the DB, smaller - not worth importing
 *   missingNoSize     not in the DB, no readable size
 *
 * Reports go to rawdata13.10/reports/dbCheck.*.json.
 *
 * Usage:
 *   cd server
 *   npx tsx --env-file=.env.dev local/checkRawData1310Models.ts
 */
import mongoose from 'mongoose';
import { connectDB } from '../config/db';
import { Item } from '../models/Item';
import { parseSheetRows } from '../../frontend/src/app/helpers/inventoryPageHelpers/sheet.helper';
import { normalizeModelKey } from '../../frontend/src/app/helpers/inventoryPageHelpers/displaySafe.helper';
import {
	formatGb,
	parseSizeGb,
} from '../../frontend/src/app/helpers/inventoryPageHelpers/memorySize.helper';
import { MIN_STORAGE_GB } from '../../frontend/src/app/helpers/inventoryPageHelpers/rowNormalize.helper';
import {
	cleanModel,
	groupBy,
	parseRawData,
	readWorkbook,
	REPORTS_DIR,
	writeReport,
} from './rawdata13.10/rawData1310';

type SheetRow = Record<string, unknown> & { __rowNum__: number };
type Source = {
	sheet: string;
	excelRow: number;
	model: string;
	size: unknown;
	sizeGb: number | null;
};
type Status =
	| 'existing'
	| 'deleted'
	| 'dashMatch'
	| 'missing'
	| 'missingUnder8Gb'
	| 'missingNoSize';
type ModelCheck = {
	model: string;
	status: Status;
	depoloma: string | null;
	sizeConflict: boolean;
	/** Every spelling seen in the sheets, when there's more than one. */
	spellings?: string[];
	/** The DB's spelling of the model(s) it matched. */
	dbModels: string[];
	sources: Source[];
};

const SHEETS: Record<string, { model: string; size: string; sizeGb: (raw: unknown) => number | null }> = {
	Sheet1: {
		model: 'Model',
		size: 'rawData',
		sizeGb: (raw) => parseRawData(raw).depolomaGb,
	},
	sheet2: { model: 'model', size: 'bellek', sizeGb: parseSizeGb },
};

function collectSources(): Source[] {
	const wb = readWorkbook();
	return Object.entries(SHEETS).flatMap(([sheet, columns]) =>
		parseSheetRows<SheetRow>(wb, sheet).flatMap((row) => {
			const model = cleanModel(row[columns.model]);
			if (!model) return [];
			const size = row[columns.size] ?? null;
			return [
				{
					sheet,
					excelRow: row.__rowNum__ + 1,
					model,
					size,
					sizeGb: columns.sizeGb(size),
				},
			];
		}),
	);
}

function missingBucket(sizeGb: number | null): Status {
	if (sizeGb === null) return 'missingNoSize';
	return sizeGb >= MIN_STORAGE_GB ? 'missing' : 'missingUnder8Gb';
}

async function main(): Promise<void> {
	const sources = collectSources();
	const models = groupBy(sources, (s) => normalizeModelKey(s.model));

	await connectDB();
	const items = await Item.find({}).select('model deletedAt').lean();
	await mongoose.disconnect();

	const active = items.filter((i) => !i.deletedAt);
	const index = (list: typeof items, key: (m: string) => string) =>
		groupBy(list, (i) => key(i.model.trim()));
	const upper = (m: string) => m.toUpperCase();
	const activeExact = index(active, upper);
	const deletedExact = index(
		items.filter((i) => i.deletedAt),
		upper,
	);
	const activeByKey = index(active, normalizeModelKey);

	const checks = [...models].map(([key, group]): ModelCheck => {
		const spellings = [...new Set(group.map((s) => s.model))];
		const sizes = [
			...new Set(group.map((s) => s.sizeGb).filter((gb) => gb !== null)),
		];
		const sizeGb = sizes.length > 0 ? Math.max(...sizes) : null;
		const found = (lookup: Map<string, typeof items>) =>
			spellings.flatMap((m) => lookup.get(upper(m)) ?? []);

		const exact = found(activeExact);
		const deleted = found(deletedExact);
		const byKey = activeByKey.get(key) ?? [];
		const [status, dbItems]: [Status, typeof items] =
			exact.length > 0
				? ['existing', exact]
				: deleted.length > 0
					? ['deleted', deleted]
					: byKey.length > 0
						? ['dashMatch', byKey]
						: [missingBucket(sizeGb), []];

		return {
			model: spellings[0],
			status,
			depoloma: sizeGb === null ? null : formatGb(sizeGb),
			sizeConflict: sizes.length > 1,
			...(spellings.length > 1 && { spellings }),
			dbModels: [...new Set(dbItems.map((i) => i.model))],
			sources: group,
		};
	});

	const statuses: Status[] = [
		'existing',
		'deleted',
		'dashMatch',
		'missing',
		'missingUnder8Gb',
		'missingNoSize',
	];
	const byStatus = (status: Status) => checks.filter((c) => c.status === status);
	const missing = byStatus('missing');

	writeReport('dbCheck.summary.json', {
		dbItems: { active: active.length, deleted: items.length - active.length },
		sheetRowsWithModel: Object.fromEntries(
			[...groupBy(sources, (s) => s.sheet)].map(([k, v]) => [k, v.length]),
		),
		uniqueModels: checks.length,
		mergedSpellings: checks.filter((c) => c.spellings).length,
		inBothSheets: checks.filter(
			(c) => new Set(c.sources.map((s) => s.sheet)).size > 1,
		).length,
		sizeConflicts: checks.filter((c) => c.sizeConflict).length,
		counts: Object.fromEntries(statuses.map((s) => [s, byStatus(s).length])),
		missingBySheet: Object.fromEntries(
			Object.keys(SHEETS).map((sheet) => [
				sheet,
				missing.filter((c) => c.sources.some((s) => s.sheet === sheet)).length,
			]),
		),
		missingByDepoloma: Object.fromEntries(
			[...groupBy(missing, (c) => c.depoloma)].map(([k, v]) => [k, v.length]),
		),
	});
	for (const status of statuses) {
		writeReport(`dbCheck.${status}.json`, byStatus(status));
	}

	console.log(
		`${checks.length} unique models: ${statuses
			.map((s) => `${byStatus(s).length} ${s}`)
			.join(', ')} -> ${REPORTS_DIR.pathname}`,
	);
}

main().catch(async (err) => {
	console.error(err);
	await mongoose.disconnect();
	process.exit(1);
});
