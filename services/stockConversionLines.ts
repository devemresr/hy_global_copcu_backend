import { storedStockConversionLineSchema } from '../schemas/stockConversion.schema';
// Validate both legacy single-line documents and new atomic supplier batches.
export function stockConversionLines(operation: object) {
	const lines =
		'lines' in operation &&
		Array.isArray(operation.lines) &&
		operation.lines.length
			? operation.lines
			: [operation];
	return lines.map((line) => storedStockConversionLineSchema.parse(line));
}
