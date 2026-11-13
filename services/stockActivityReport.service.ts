export type MovementSupplier = {
	bayiId?: string | null;
	bayiName: string;
	currentBayiName?: string | null;
	quantity: number;
	revenue: number;
	costOfGoods: number;
	sourcePurchases?: { orderId: string; lotId: string; quantity: number }[];
};
export type ReportMovement = {
	id: string;
	operationId?: string;
	kind: string;
	createdAt: Date;
	bayiId?: string | null;
	bayiName: string | null;
	currentBayiName?: string | null;
	type: string;
	memoryGb: number | null;
	quantityUnit: 'piece' | 'kg';
	quantity: number;
	purchaseCost: number;
	revenue: number | null;
	profit: number | null;
	orderId: string | null;
	suppliers?: MovementSupplier[];
};
const day = (date: Date) => {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Europe/Istanbul',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).formatToParts(date);
	const part = (type: string) => parts.find((p) => p.type === type)!.value;
	return `${part('year')}-${part('month')}-${part('day')}`;
};
const totals = () => ({
	purchaseCost: 0,
	costOfGoods: 0,
	revenue: 0,
	profit: 0,
});
export function stockActivityReport(
	movements: ReportMovement[],
	page: number,
	pageSize: number,
) {
	const activities = new Map<
		string,
		{
			id: string;
			kind: string;
			createdAt: Date;
			date: string;
			lines: ReportMovement[];
		}
	>();
	const days = new Map<
		string,
		ReturnType<typeof totals> & { date: string; count: number }
	>();
	const bayis = new Map<
		string,
		ReturnType<typeof totals> & {
			bayiId: string | null;
			bayiName: string;
			currentBayiName: string | null;
			products: Map<
				string,
				ReturnType<typeof totals> & {
					type: string;
					memoryGb: number | null;
					quantityUnit: 'piece' | 'kg';
					purchasedQuantity: number;
					soldQuantity: number;
				}
			>;
		}
	>();
	for (const row of movements) {
		const id = `${row.kind === 'purchase' ? 'purchase' : 'sale'}:${row.operationId ?? row.orderId ?? row.id}`;
		const activity = activities.get(id) ?? {
			id,
			kind: row.kind,
			createdAt: row.createdAt,
			date: day(row.createdAt),
			lines: [],
		};
		activity.lines.push(row);
		activities.set(id, activity);
		const daily = days.get(activity.date) ?? {
			date: activity.date,
			count: 0,
			...totals(),
		};
		daily.purchaseCost += row.kind === 'purchase' ? row.purchaseCost : 0;
		daily.costOfGoods += row.kind === 'purchase' ? 0 : row.purchaseCost;
		daily.revenue += row.revenue ?? 0;
		daily.profit += row.profit ?? 0;
		days.set(activity.date, daily);
		const parts =
			row.kind === 'purchase'
				? [
						{
							bayiId: row.bayiId,
							bayiName: row.bayiName ?? '',
							currentBayiName: row.currentBayiName,
							quantity: row.quantity,
							revenue: 0,
							costOfGoods: row.purchaseCost,
						},
					]
				: (row.suppliers ?? []);
		for (const part of parts) {
			const key = part.bayiId ?? `unlinked:${part.bayiName}`;
			const bayi = bayis.get(key) ?? {
				bayiId: part.bayiId ?? null,
				bayiName: part.bayiName,
				currentBayiName: part.currentBayiName ?? null,
				...totals(),
				products: new Map(),
			};
			const productKey = `${row.type}:${row.memoryGb}:${row.quantityUnit}`;
			const product = bayi.products.get(productKey) ?? {
				type: row.type,
				memoryGb: row.memoryGb,
				quantityUnit: row.quantityUnit,
				purchasedQuantity: 0,
				soldQuantity: 0,
				...totals(),
			};
			if (row.kind === 'purchase') {
				bayi.purchaseCost += part.costOfGoods;
				product.purchaseCost += part.costOfGoods;
				product.purchasedQuantity += part.quantity;
			} else {
				bayi.costOfGoods += part.costOfGoods;
				bayi.revenue += part.revenue;
				bayi.profit += part.revenue - part.costOfGoods;
				product.costOfGoods += part.costOfGoods;
				product.revenue += part.revenue;
				product.profit += part.revenue - part.costOfGoods;
				product.soldQuantity += part.quantity;
			}
			bayi.products.set(productKey, product);
			bayis.set(key, bayi);
		}
	}
	const all = [...activities.values()];
	for (const activity of all) days.get(activity.date)!.count++;
	return {
		activities: all.slice((page - 1) * pageSize, page * pageSize),
		activityCount: all.length,
		activityPages: Math.max(1, Math.ceil(all.length / pageSize)),
		dailyMovementTotals: [...days.values()].sort((a, b) =>
			b.date.localeCompare(a.date),
		),
		bayiReports: [...bayis.values()]
			.map(({ products, ...bayi }) => ({
				...bayi,
				products: [...products.values()],
			}))
			.sort((a, b) =>
				(a.currentBayiName ?? a.bayiName).localeCompare(
					b.currentBayiName ?? b.bayiName,
					'tr',
				),
			),
	};
}
