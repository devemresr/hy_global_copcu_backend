import { resolve } from 'node:path';
import type { ItemData } from '../models/Item';

// Written by exportItemsSnapshot.ts, read by seed.ts, and served as a static
// file by the frontend as its fallback when GET /items can't be reached.
export const SNAPSHOT_PATH = resolve(
	import.meta.dirname,
	'../../frontend/public/items-snapshot.json',
);

export type ItemsSnapshot = {
	exportedAt: string;
	items: ItemData[];
};
