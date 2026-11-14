import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import env from '../../config/env';
import { Item, type ItemData } from '../../models/Item';
import { withCatalogRead } from '../sync/version.service';

export type InventorySnapshot = { exportedAt: string; items: ItemData[] };
export function inventorySnapshotPath() {
	return env.ITEMS_SNAPSHOT_PATH
		? resolve(env.ITEMS_SNAPSHOT_PATH)
		: resolve(
				import.meta.dirname,
				'../../../frontend/public/items-snapshot.json',
			);
}
export async function writeInventorySnapshot(
	target = inventorySnapshotPath(),
): Promise<{ exportedAt: Date; itemCount: number }> {
	const snapshot = await withCatalogRead(async () => {
		const docs = await Item.find({ deletedAt: null })
			.select(
				'uretici ram eslesmeTuru bellekTipi sorgulananDeger model depolama depolamaBirimi fiyat paraBirimi fiyatBirimi',
			)
			.sort({ model: 1, _id: 1 })
			.lean();
		const result: InventorySnapshot = {
			exportedAt: new Date().toISOString(),
			items: docs.map((doc) => ({
				uretici: doc.uretici ?? null,
				ram: doc.ram ?? null,
				eslesmeTuru: doc.eslesmeTuru ?? null,
				bellekTipi: doc.bellekTipi ?? null,
				sorgulananDeger: doc.sorgulananDeger ?? null,
				model: doc.model,
				depolama: doc.depolama ?? null,
				depolamaBirimi: doc.depolamaBirimi ?? 'GB',
				fiyat: doc.fiyat ?? null,
				paraBirimi: doc.paraBirimi ?? 'TRY',
				fiyatBirimi: doc.fiyatBirimi ?? 'piece',
			})),
		};
		return result;
	});
	await mkdir(dirname(target), { recursive: true });
	const temporary = target + '.' + randomUUID() + '.tmp';
	try {
		await writeFile(temporary, JSON.stringify(snapshot) + '\n', {
			encoding: 'utf8',
			flag: 'wx',
			mode: 0o644,
		});
		// Publish only a complete file; an export failure retains the last good copy.
		await rename(temporary, target);
	} finally {
		await rm(temporary, { force: true });
	}
	return {
		exportedAt: new Date(snapshot.exportedAt),
		itemCount: snapshot.items.length,
	};
}
