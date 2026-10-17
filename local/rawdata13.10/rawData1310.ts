// Shared by parseRawData1310.ts and checkRawData1310Models.ts: where the
// workbook and reports live, how it's read, how a model cell is cleaned and
// how Sheet1's rawData is read (rules in parseRawData1310.ts's header).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseWorkbookFromBuffer } from '../../../frontend/src/app/helpers/inventoryPageHelpers/sheet.helper';
import {
	parseSize,
	toGb,
} from '../../../frontend/src/app/helpers/inventoryPageHelpers/memorySize.helper';

export const INPUT = new URL('./rawData13.10.xlsx', import.meta.url);
export const REPORTS_DIR = new URL('./reports/', import.meta.url);

export function readWorkbook() {
	const buffer = readFileSync(INPUT);
	return parseWorkbookFromBuffer(
		buffer.buffer.slice(
			buffer.byteOffset,
			buffer.byteOffset + buffer.byteLength,
		) as ArrayBuffer,
	);
}

/** Trimmed, with non-ASCII notes like "长条" stripped; null when blank. */
export function cleanModel(raw: unknown): string | null {
	return (
		String(raw ?? '')
			.replace(/[^\x20-\x7E]/g, '')
			.trim() || null
	);
}

export function writeReport(name: string, data: unknown) {
	mkdirSync(REPORTS_DIR, { recursive: true });
	writeFileSync(new URL(name, REPORTS_DIR), JSON.stringify(data, null, 2));
}

export const KNOWN_BELLEK_TIPI = ['EMMC', 'EMCP', 'UMCP', 'UFS', 'MCP'];

export type IssueCode =
	| 'noModel'
	| 'noRawData'
	| 'unparseableRawData'
	| 'unparseableSizePart'
	| 'notPowerOfTwo'
	| 'unknownBellekTipi'
	| 'conflictingDuplicate';

export type WarningCode =
	| 'strippedNonAscii'
	| 'strippedNonAsciiModel'
	| 'biggerNumberFirst'
	| 'moreThanTwoParts';

export type ParsedRawData = {
	bellekTipi: string | null;
	depolomaGb: number | null;
	issues: IssueCode[];
	warnings: WarningCode[];
	notes: string[];
};

// "EMCP254# 4+128" -> letters "EMCP", ignored "254#", size "4+128"
const RAW_DATA_PATTERN = /^([a-z]*)\s*(?:\d*#)?\s*(.*)$/i;
const SIZE_PART_PATTERN = /^\d+(?:\.\d+)?\s*[a-z]*$/i;

function isPowerOfTwo(gb: number): boolean {
	// sub-GB sizes count too: 0.5 GB = 512 MB
	const mb = gb * 1024;
	return Number.isInteger(mb) && mb > 0 && (mb & (mb - 1)) === 0;
}

// "128" -> 128 (GB by default), "8gb" -> 8, "1t" -> 1024, "1D2" -> null
function parseSizePartGb(part: string): number | null {
	if (!SIZE_PART_PATTERN.test(part)) return null;
	if (/^[\d.\s]+$/.test(part)) return parseFloat(part);
	const size = parseSize(part);
	return size ? toGb(size) : null;
}

export function parseRawData(raw: unknown): ParsedRawData {
	const result: ParsedRawData = {
		bellekTipi: null,
		depolomaGb: null,
		issues: [],
		warnings: [],
		notes: [],
	};

	if (typeof raw === 'number') {
		result.depolomaGb = raw;
	} else {
		let text = String(raw ?? '').trim();
		if (!text) {
			result.issues.push('noRawData');
			return result;
		}

		const ascii = text.replace(/[^\x20-\x7E]/g, '').trim();
		if (ascii !== text) {
			result.warnings.push('strippedNonAscii');
			result.notes.push(`stripped "${text.replace(/[\x20-\x7E]/g, '')}"`);
			text = ascii;
		}

		const match = text.match(RAW_DATA_PATTERN);
		if (!match || !match[2]) {
			result.issues.push('unparseableRawData');
			return result;
		}

		const [, letters, sizeText] = match;
		if (letters) {
			result.bellekTipi = letters.toUpperCase();
			if (!KNOWN_BELLEK_TIPI.includes(result.bellekTipi)) {
				result.issues.push('unknownBellekTipi');
			}
		}

		const parts = sizeText.split('+').map((p) => p.trim());
		const sizes = parts.map(parseSizePartGb);
		const badParts = parts.filter((_, i) => sizes[i] === null);
		if (badParts.length > 0) {
			result.issues.push('unparseableSizePart');
			result.notes.push(`unreadable size part(s): ${badParts.join(', ')}`);
			return result;
		}

		const gbs = sizes as number[];
		if (gbs.length > 2) result.warnings.push('moreThanTwoParts');
		if (gbs.length === 2 && gbs[0] > gbs[1]) {
			result.warnings.push('biggerNumberFirst');
		}
		result.depolomaGb = Math.max(...gbs);
	}

	if (result.depolomaGb !== null && !isPowerOfTwo(result.depolomaGb)) {
		result.issues.push('notPowerOfTwo');
	}
	return result;
}

export function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
	const groups = new Map<K, T[]>();
	for (const item of items) {
		const k = key(item);
		groups.set(k, [...(groups.get(k) ?? []), item]);
	}
	return groups;
}
