/**
 * Dumps every live item into frontend/public/items-snapshot.json (see
 * itemsSnapshot.ts). Re-run before a frontend deploy to keep it fresh:
 *   cd server
 *   npm run export-snapshot
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import mongoose from 'mongoose';
import { connectDB } from '../config/db';
import { Item } from '../models/Item';
import logger from '../util/logger';
import { SNAPSHOT_PATH, type ItemsSnapshot } from './itemsSnapshot';

const log = logger.child({ method: 'exportItemsSnapshot' });

async function main(): Promise<void> {
	await connectDB();

	const docs = await Item.find({ deletedAt: null }).sort({ model: 1 }).lean();
	const snapshot: ItemsSnapshot = {
		exportedAt: new Date().toISOString(),
		items: docs.map((doc) => ({
			uretici: doc.uretici ?? null,
			ram: doc.ram ?? null,
			eslesmeTuru: doc.eslesmeTuru ?? null,
			bellekTipi: doc.bellekTipi ?? null,
			sorgulananDeger: doc.sorgulananDeger ?? null,
			model: doc.model,
			depolama: doc.depolama ?? null,
			depolamaBirimi: doc.depolamaBirimi,
			fiyat: doc.fiyat ?? null,
			paraBirimi: doc.paraBirimi,
		})),
	};

	await mkdir(dirname(SNAPSHOT_PATH), { recursive: true });
	await writeFile(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, '\t')}\n`);
	log.info({ count: snapshot.items.length, path: SNAPSHOT_PATH }, 'Items snapshot written');
}

main()
	.catch((error: unknown) => {
		log.error({ err: error }, 'Snapshot export failed');
		process.exitCode = 1;
	})
	.finally(() => mongoose.disconnect());
