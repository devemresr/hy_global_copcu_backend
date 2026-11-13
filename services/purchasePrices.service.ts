import { Item } from '../models/Item';
import type { PriceUnit } from '../schemas/item.schema';

// Match the common catalog price per size, currency and quantity basis.
export async function loadPurchasePrices() {
	const items = await Item.find({ deletedAt: null })
		.select('bellekTipi depolama depolamaBirimi fiyat paraBirimi fiyatBirimi')
		.lean();
	const groups = new Map<
		string,
		{
			key: string;
			currency: string;
			quantityUnit: 'piece' | 'kg';
			sourceUnits: Set<PriceUnit>;
			counts: Map<number | null, number>;
		}
	>();
	for (const item of items) {
		const type = item.bellekTipi?.trim().toUpperCase();
		if ((type !== 'EMMC' && type !== 'EMCP') || item.depolama == null) continue;
		const memoryGb = item.depolama * (item.depolamaBirimi === 'TB' ? 1024 : 1);
		const unit = item.fiyatBirimi ?? 'piece';
		const quantityUnit = unit === 'piece' ? 'piece' : 'kg';
		const key = type + ':' + memoryGb + ':' + quantityUnit;
		const id = key + ':' + item.paraBirimi;
		const group = groups.get(id) ?? {
			key,
			currency: item.paraBirimi,
			quantityUnit,
			sourceUnits: new Set<PriceUnit>(),
			counts: new Map<number | null, number>(),
		};
		const price =
			item.fiyat == null ? null : item.fiyat * (unit === 'g' ? 1000 : 1);
		group.counts.set(price, (group.counts.get(price) ?? 0) + 1);
		group.sourceUnits.add(unit);
		groups.set(id, group);
	}
	return [...groups.values()].map(
		({ key, currency, quantityUnit, sourceUnits, counts }) => {
			const [unitPrice] = [...counts].sort(
				(a, b) =>
					b[1] - a[1] ||
					String(a[0] ?? '').localeCompare(String(b[0] ?? ''), undefined, {
						numeric: true,
					}),
			)[0];
			return {
				key,
				currency,
				quantityUnit,
				sourceUnits: [...sourceUnits],
				unitPrice,
				hasExceptions: counts.size > 1,
			};
		},
	);
}

export async function loadOrderPurchasePricing() {
	const prices: Record<string, Record<string, number>> = {
		EMMC: {},
		EMCP: {},
		IPHONE: {},
		TABLET: {},
	};
	const unitPrices: Record<
		string,
		Record<string, Partial<Record<PriceUnit, number>>>
	> = {};
	const quantityUnits: Record<string, Record<string, PriceUnit[]>> = {};
	for (const price of await loadPurchasePrices()) {
		if (price.currency !== 'TRY') continue;
		const [type, size] = price.key.split(':');
		unitPrices[type] ??= {};
		unitPrices[type][size] ??= {};
		quantityUnits[type] ??= {};
		quantityUnits[type][size] ??= [];
		const declared = new Set([
			...quantityUnits[type][size],
			...price.sourceUnits,
		]);
		quantityUnits[type][size] = (['piece', 'kg', 'g'] as const).filter((unit) =>
			declared.has(unit),
		);
		if (price.unitPrice === null) continue;
		unitPrices[type][size][price.quantityUnit] = price.unitPrice;
		if (price.quantityUnit === 'piece') prices[type][size] = price.unitPrice;
		else unitPrices[type][size].g = price.unitPrice / 1000;
	}
	return { prices, unitPrices, quantityUnits };
}
export async function loadOrderPurchasePrices() {
	return (await loadOrderPurchasePricing()).prices;
}
