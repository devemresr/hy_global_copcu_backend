import { stockProductKey, type loadStock } from './stock.service';

type State = Awaited<ReturnType<typeof loadStock>>;
type Sale = State['book']['sales'][number];

export function summarizeStockSales(sales: Sale[], byMemory = false) {
	const groups = new Map<
		string,
		{
			type: string | null;
			memoryGb: number | null;
			quantityUnit: string;
			quantity: number;
			revenue: number;
			costOfGoods: number;
		}
	>();
	for (const sale of sales) {
		if (byMemory && sale.memoryGb == null) continue;
		const key = byMemory
			? `${sale.memoryGb}:${sale.quantityUnit}`
			: stockProductKey(sale);
		const row = groups.get(key) ?? {
			type: byMemory ? null : sale.type,
			memoryGb: sale.memoryGb ?? null,
			quantityUnit: sale.quantityUnit,
			quantity: 0,
			revenue: 0,
			costOfGoods: 0,
		};
		row.quantity += sale.quantity;
		row.revenue += sale.revenue;
		row.costOfGoods += sale.costOfGoods;
		groups.set(key, row);
	}
	return [...groups.values()].map((row) => ({
		...row,
		averagePurchaseCost:
			row.quantity > 0 ? row.costOfGoods / row.quantity : null,
		averageSellingPrice: row.quantity > 0 ? row.revenue / row.quantity : null,
		profit: row.revenue - row.costOfGoods,
		margin:
			row.revenue > 0
				? ((row.revenue - row.costOfGoods) / row.revenue) * 100
				: null,
	}));
}

export function summarizeSupplierSales(sales: Sale[]) {
	const groups = new Map<
		string,
		{
			bayiId: string | null;
			bayiName: string;
			type: string;
			memoryGb: number | null;
			quantityUnit: string;
			quantity: number;
			revenue: number;
			costOfGoods: number;
		}
	>();
	for (const sale of sales)
		for (const part of sale.suppliers ?? []) {
			const key = (part.bayiId ?? 'unlinked') + ':' + stockProductKey(sale);
			const group = groups.get(key) ?? {
				bayiId: part.bayiId ?? null,
				bayiName: part.bayiName,
				type: sale.type,
				memoryGb: sale.memoryGb ?? null,
				quantityUnit: sale.quantityUnit,
				quantity: 0,
				revenue: 0,
				costOfGoods: 0,
			};
			group.quantity += part.quantity;
			group.revenue += part.revenue;
			group.costOfGoods += part.costOfGoods;
			groups.set(key, group);
		}
	return [...groups.values()].map((group) => ({
		...group,
		profit: group.revenue - group.costOfGoods,
		margin:
			group.revenue > 0
				? ((group.revenue - group.costOfGoods) / group.revenue) * 100
				: null,
	}));
}
