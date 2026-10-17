/**
 * Parses rawdata13.10/rawData13.10.xlsx into JSON reports for review.
 * Read-only: touches neither the DB nor the xlsx.
 *
 * Sheet1 (rawData + Model) - rawData packs bellekTipi and depoloma together,
 * e.g. "EMCP254# 4+128" -> bellekTipi EMCP, depoloma 128 GB:
 * - Leading letters are bellekTipi ("EMCP254#" -> EMCP, "221#" -> none).
 *   The number before '#' is ignored.
 * - The size part is one or more '+'-joined numbers ("4+128", "1.5+8gb",
 *   "64g", 128); the biggest one is depoloma. No unit means GB.
 * - A depoloma that isn't a power of 2 is reported, not dropped.
 * - Merged rawData cells cover a block of models; unmerging gives every
 *   model in the block that value.
 * - The sheet lists most models twice. Copies that read the same collapse
 *   into the first (see duplicateRows); copies that disagree are reported.
 * - Non-ASCII notes after a model ("TP17A8长") are stripped and reported.
 *
 * sheet2 isn't parsed yet - its rules are still to be decided.
 *
 * Reports go to rawdata13.10/reports/:
 *   summary.json       counts + every distinct rawData and how it was read
 *   sheet1.parsed.json rows with no issues (warnings allowed)
 *   sheet1.issues.json rows with an issue, grouped by issue code
 *   sheet1.warnings.json rows parsed fine but worth a look, grouped by code
 *
 * Usage:
 *   cd server
 *   npx tsx local/parseRawData1310.ts
 */
import { parseSheetRows } from '../../frontend/src/app/helpers/inventoryPageHelpers/sheet.helper';
import { formatGb } from '../../frontend/src/app/helpers/inventoryPageHelpers/memorySize.helper';
import {
	cleanModel,
	groupBy,
	INPUT,
	parseRawData,
	readWorkbook,
	REPORTS_DIR,
	writeReport,
	type ParsedRawData,
} from './rawdata13.10/rawData1310';

type Sheet1Row = { rawData?: unknown; Model?: unknown; __rowNum__: number };

type Sheet1Result = ParsedRawData & {
	excelRow: number;
	model: string | null;
	rawData: unknown;
	depoloma: string | null;
	/** Later excel rows with the same model and the same reading. */
	duplicateRows: number[];
};

function groupByCode<T extends { issues: string[]; warnings: string[] }>(
	rows: T[],
	key: 'issues' | 'warnings',
): Record<string, T[]> {
	const groups: Record<string, T[]> = {};
	for (const row of rows) {
		for (const code of row[key]) (groups[code] ??= []).push(row);
	}
	return groups;
}

function parseSheet1Row(row: Sheet1Row): Sheet1Result {
	const parsed = parseRawData(row.rawData);
	const rawModel = String(row.Model ?? '').trim();
	const model = cleanModel(rawModel);
	if (!model) parsed.issues.unshift('noModel');
	if (model && model !== rawModel) {
		parsed.warnings.push('strippedNonAsciiModel');
		parsed.notes.push(`model was "${rawModel}"`);
	}
	return {
		excelRow: row.__rowNum__ + 1,
		model,
		rawData: row.rawData ?? null,
		...parsed,
		depoloma: parsed.depolomaGb === null ? null : formatGb(parsed.depolomaGb),
		duplicateRows: [],
	};
}

// Copies of a model that read the same collapse into the first one; copies
// that read differently are all kept and reported.
function dedupeByModel(results: Sheet1Result[]): Sheet1Result[] {
	const kept = results.filter((r) => !r.model);
	const byModel = groupBy(
		results.filter((r) => r.model),
		(r) => r.model!.toUpperCase(),
	);
	for (const group of byModel.values()) {
		const readings = [
			...groupBy(group, (r) => `${r.bellekTipi}|${r.depoloma}`).values(),
		].map(([first, ...rest]) => {
			first.duplicateRows = rest.map((r) => r.excelRow);
			return first;
		});
		if (readings.length > 1) {
			for (const r of readings) {
				r.issues.push('conflictingDuplicate');
				r.notes.push(
					`other readings: ${readings
						.filter((o) => o !== r)
						.map((o) => `row ${o.excelRow} ${JSON.stringify(o.rawData)}`)
						.join(', ')}`,
				);
			}
		}
		kept.push(...readings);
	}
	return kept.sort((a, b) => a.excelRow - b.excelRow);
}

function main() {
	const wb = readWorkbook();

	const sheet1Rows = parseSheetRows<Sheet1Row>(wb, 'Sheet1');
	const sheet1 = dedupeByModel(sheet1Rows.map(parseSheet1Row));
	const clean = sheet1.filter((r) => r.issues.length === 0);
	const withIssues = sheet1.filter((r) => r.issues.length > 0);
	const issues = groupByCode(withIssues, 'issues');
	const warnings = groupByCode(
		sheet1.filter((r) => r.warnings.length > 0),
		'warnings',
	);

	// One line per distinct rawData - the quickest way to eyeball every rule.
	const interpretations = [
		...groupBy(sheet1, (r) => JSON.stringify(r.rawData)).values(),
	].map((group) => {
		const { depolomaGb, ...reading } = parseRawData(group[0].rawData);
		return {
			rawData: group[0].rawData,
			models: group.length,
			...reading,
			depoloma: depolomaGb === null ? null : formatGb(depolomaGb),
		};
	});

	writeReport('summary.json', {
		input: INPUT.pathname,
		sheetNames: wb.SheetNames,
		sheet1: {
			excelRows: sheet1Rows.length,
			exactDuplicateRowsCollapsed: sheet1Rows.length - sheet1.length,
			models: sheet1.length,
			clean: clean.length,
			withIssues: withIssues.length,
			issueCounts: Object.fromEntries(
				Object.entries(issues).map(([k, v]) => [k, v.length]),
			),
			warningCounts: Object.fromEntries(
				Object.entries(warnings).map(([k, v]) => [k, v.length]),
			),
			bellekTipiCounts: Object.fromEntries(
				[...groupBy(clean, (r) => r.bellekTipi ?? '(none)')].map(
					([k, v]) => [k, v.length],
				),
			),
			depolomaCounts: Object.fromEntries(
				[...groupBy(clean, (r) => r.depoloma)].map(([k, v]) => [
					k,
					v.length,
				]),
			),
			interpretations,
		},
		sheet2: 'not parsed yet',
	});
	writeReport('sheet1.parsed.json', clean);
	writeReport('sheet1.issues.json', issues);
	writeReport('sheet1.warnings.json', warnings);

	console.log(
		`Sheet1: ${sheet1Rows.length} rows -> ${sheet1.length} models, ${clean.length} clean, ${withIssues.length} with issues -> ${REPORTS_DIR.pathname}`,
	);
}

main();
