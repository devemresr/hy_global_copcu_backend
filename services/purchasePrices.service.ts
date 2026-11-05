import { Item } from '../models/Item';

// Match the common price used by the side-by-side editor, per size and currency.
// Keep exceptions and currencies separate rather than averaging catalog prices.
export async function loadPurchasePrices() {
	const items = await Item.find({ deletedAt: null })
		.select('bellekTipi depolama depolamaBirimi fiyat paraBirimi')
		.lean();
	const groups = new Map<
		string,
		{ key: string; currency: string; counts: Map<number | null, number> }
	>();
	for (const item of items) {
		const type = item.bellekTipi?.trim().toUpperCase();
		if ((type !== 'EMMC' && type !== 'EMCP') || item.depolama == null) continue;
		const memoryGb = item.depolama * (item.depolamaBirimi === 'TB' ? 1024 : 1);
		const key = `${type}:${memoryGb}:piece`;
		const id = `${key}:${item.paraBirimi}`;
		const group = groups.get(id) ?? {
			key,
			currency: item.paraBirimi,
			counts: new Map<number | null, number>(),
		};
		const price = item.fiyat ?? null;
		group.counts.set(price, (group.counts.get(price) ?? 0) + 1);
		groups.set(id, group);
	}
	return [...groups.values()].map(({ key, currency, counts }) => {
		const [unitPrice] = [...counts].sort(
			(a, b) =>
				b[1] - a[1] ||
				String(a[0] ?? '').localeCompare(String(b[0] ?? ''), undefined, {
					numeric: true,
				}),
		)[0];
		return { key, currency, unitPrice, hasExceptions: counts.size > 1 };
	});
}

export async function loadOrderPurchasePrices() {
	const prices: Record<string, Record<string, number>> = {
		EMMC: {},
		EMCP: {},
		IPHONE: {},
		TABLET: {},
	};
	for (const price of await loadPurchasePrices()) {
		if (price.currency !== 'TRY' || price.unitPrice === null) continue;
		const [type, size] = price.key.split(':');
		prices[type][size] = price.unitPrice;
	}
	return prices;
}
