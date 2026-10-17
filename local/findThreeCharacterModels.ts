/**
 * Read-only report of items whose trimmed model is exactly 3 characters.
 * Includes digits/punctuation and soft-deleted items; use --active-only to
 * restrict the report to active items. Never changes items, indexes or logs.
 * Usage: npm run items:short-models [-- --active-only]
 */
import { writeFileSync } from 'node:fs';
import mongoose from 'mongoose';
import { connectDB } from '../config/db';
import { Item } from '../models/Item';

async function main() {
	const args = process.argv.slice(2);
	if (args.some((arg) => arg !== '--active-only')) throw new Error('Only --active-only is supported');
	mongoose.set('autoIndex', false);
	mongoose.set('autoCreate', false);
	await connectDB();
	const items = await Item.find({
		...(args.includes('--active-only') ? { deletedAt: null } : {}),
		$expr: { $eq: [{ $strLenCP: { $trim: { input: { $ifNull: ['$model', ''] } } } }, 3] },
	}).sort({ model: 1 }).lean();
	const reportPath = new URL('./threeCharacterModels.report.json', import.meta.url);
	writeFileSync(reportPath, JSON.stringify({ count: items.length, activeOnly: args.includes('--active-only'), items }, null, 2));
	console.table(items.map(({ _id, model, depolama, depolamaBirimi, deletedAt }) => ({ id: String(_id), model, depolama, depolamaBirimi, deletedAt })));
	console.log(`${items.length} items. Report: ${reportPath.pathname}`);
}

main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
}).finally(() => mongoose.disconnect());
