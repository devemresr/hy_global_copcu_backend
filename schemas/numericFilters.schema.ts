import { z } from 'zod';

export const NUMERIC_FIELDS = {
	total: 'İşlem toplamı (TL)',
	lineTotal: 'Ürün toplamı (TL)',
	recordPiece: 'Alış toplam miktarı (adet)',
	recordKg: 'Alış toplam miktarı (kg)',
	recordG: 'Alış toplam miktarı (g)',
	lineCount: 'Alıştaki ürün satırı sayısı',
	memoryGb: 'Bellek boyutu (GB)',
	quantityPiece: 'Ürün miktarı (adet)',
	quantityKg: 'Ürün miktarı (kg)',
	quantityG: 'Ürün miktarı (g)',
	unitPricePiece: 'Birim alış fiyatı (TL/adet)',
	unitPriceKg: 'Birim alış fiyatı (TL/kg)',
	unitPriceG: 'Birim alış fiyatı (TL/g)',
	originalUnitPricePiece: 'Liste alış fiyatı (TL/adet)',
	originalUnitPriceKg: 'Liste alış fiyatı (TL/kg)',
	originalUnitPriceG: 'Liste alış fiyatı (TL/g)',
	priceAdjustmentPiece: 'Birim fiyat farkı (TL/adet)',
	priceAdjustmentKg: 'Birim fiyat farkı (TL/kg)',
	priceAdjustmentG: 'Birim fiyat farkı (TL/g)',
	totalAdjustment: 'Toplam fiyat farkı (TL)',
	purchaseCost: 'Alış maliyeti (TL)',
	revenue: 'Satış geliri (TL)',
	profit: 'Gerçekleşen kâr (TL)',
	margin: 'Kâr marjı (%)',
	sellingPricePiece: 'Birim satış fiyatı (TL/adet)',
	sellingPriceKg: 'Birim satış fiyatı (TL/kg)',
	sellingPriceG: 'Birim satış fiyatı (TL/g)',
} as const;
export type NumericField = keyof typeof NUMERIC_FIELDS;
const fields = Object.keys(NUMERIC_FIELDS) as [NumericField, ...NumericField[]];
export const numericFilterSchema = z
	.object({
		field: z.enum(fields),
		productType: z.enum(['EMMC', 'EMCP', 'IPHONE', 'TABLET']).optional(),
		memoryGb: z.number().int().min(8).max(1024).optional(),
		min: z.number().finite().min(-1e15).max(1e15).optional(),
		max: z.number().finite().min(-1e15).max(1e15).optional(),
	})
	.strict()
	.refine(
		(v) =>
			(v.min !== undefined || v.max !== undefined) &&
			(v.min === undefined || v.max === undefined || v.min <= v.max),
		'Geçerli bir sayı aralığı girin.',
	)
	.refine(
		(v) =>
			!(
				(v.productType || v.memoryGb !== undefined) &&
				['total', 'recordPiece', 'recordKg', 'recordG', 'lineCount'].includes(
					v.field,
				)
			),
		'İşlem alanına ürün koşulu eklenemez.',
	)
	.refine(
		(v) =>
			v.memoryGb === undefined ||
			v.productType === 'EMMC' ||
			v.productType === 'EMCP',
		'Bellek boyutu için eMMC veya eMCP seçin.',
	);
export type NumericFilter = z.infer<typeof numericFilterSchema>;
export function numericFieldsFor(context: 'orders' | 'stock' | 'finance') {
	return fields.filter((field) =>
		context === 'finance'
			? field === 'total'
			: context === 'orders'
				? !['purchaseCost', 'revenue', 'profit', 'margin'].includes(field) &&
					!field.startsWith('sellingPrice')
				: !field.startsWith('originalUnitPrice') &&
					!field.startsWith('priceAdjustment') &&
					field !== 'totalAdjustment' &&
					!field.startsWith('record') &&
					field !== 'lineCount',
	);
}
export const numericFiltersQuerySchema = z.preprocess((value) => {
	if (typeof value !== 'string') return value;
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}, z.array(numericFilterSchema).max(30).optional());
export function matchesNumeric(
	filters: NumericFilter[] | undefined,
	values: Partial<Record<NumericField, number | null | undefined>>,
	product?: { type: string; memoryGb?: number | null },
) {
	const test = (f: NumericFilter) => {
		const value = values[f.field];
		return (
			value != null &&
			Number.isFinite(value) &&
			(f.min === undefined || value >= f.min) &&
			(f.max === undefined || value <= f.max)
		);
	};
	const general = (filters ?? []).filter((f) => !f.productType);
	const scoped = (filters ?? []).filter((f) => f.productType);
	if (!general.every(test)) return false;
	if (!scoped.length) return true;
	const groups = new Map<string, NumericFilter[]>();
	for (const f of scoped) {
		const key = f.productType + ':' + (f.memoryGb ?? '*');
		groups.set(key, [...(groups.get(key) ?? []), f]);
	}
	return [...groups.values()].some(
		(group) =>
			product?.type === group[0].productType &&
			(group[0].memoryGb === undefined ||
				product?.memoryGb === group[0].memoryGb) &&
			group.every(test),
	);
}
export function productNumericValues(line: {
	memoryGb?: number | null;
	quantity: number;
	quantityUnit?: string;
	unitPrice?: number | null;
	originalUnitPrice?: number | null;
	priceAdjustment?: number | null;
	total?: number;
	costOfGoods?: number;
	revenue?: number;
}) {
	const unit = line.quantityUnit ?? 'piece';
	const cost = line.costOfGoods ?? line.total;
	const values: Partial<Record<NumericField, number | null | undefined>> = {
		memoryGb: line.memoryGb,
		lineTotal: line.total ?? line.revenue,
		purchaseCost: cost,
		revenue: line.revenue,
		profit:
			line.revenue === undefined || cost === undefined
				? null
				: line.revenue - cost,
		margin:
			!line.revenue || cost === undefined
				? null
				: ((line.revenue - cost) / line.revenue) * 100,
		totalAdjustment:
			line.priceAdjustment == null
				? null
				: line.priceAdjustment * line.quantity,
	};
	for (const [suffix, target] of [
		['Piece', 'piece'],
		['Kg', 'kg'],
		['G', 'g'],
	] as const) {
		const compatible =
			unit === target || (unit !== 'piece' && target !== 'piece');
		const factor = unit === target ? 1 : unit === 'g' ? 0.001 : 1000;
		values[`quantity${suffix}`] = compatible ? line.quantity * factor : null;
		for (const price of [
			'unitPrice',
			'originalUnitPrice',
			'priceAdjustment',
			'sellingPrice',
		] as const) {
			const raw =
				price === 'sellingPrice'
					? line.revenue === undefined
						? null
						: line.revenue / line.quantity
					: price === 'unitPrice'
						? (line.unitPrice ??
							(cost === undefined ? null : cost / line.quantity))
						: line[price];
			values[`${price}${suffix}`] =
				compatible && raw != null ? raw / factor : null;
		}
	}
	return values;
}
// Each selected product must satisfy its own conditions on one line.
export function orderNumericExpression(filters: NumericFilter[]) {
	const predicate = (f: NumericFilter, value: unknown) => ({
		$and: [
			{ $isNumber: value },
			...(f.min === undefined ? [] : [{ $gte: [value, f.min] }]),
			...(f.max === undefined ? [] : [{ $lte: [value, f.max] }]),
		],
	});
	const root: Partial<Record<NumericField, unknown>> = {
		total: '$total',
		lineCount: { $size: '$lines' },
		recordPiece: { $ifNull: ['$unitTotals.piece', '$quantity'] },
		recordKg: {
			$add: [
				{ $ifNull: ['$unitTotals.kg', 0] },
				{ $divide: [{ $ifNull: ['$unitTotals.g', 0] }, 1000] },
			],
		},
		recordG: {
			$add: [
				{ $ifNull: ['$unitTotals.g', 0] },
				{ $multiply: [{ $ifNull: ['$unitTotals.kg', 0] }, 1000] },
			],
		},
	};
	const lineValue = (f: NumericFilter): unknown => {
		if (f.field === 'memoryGb') return '$$line.memoryGb';
		if (f.field === 'lineTotal') return '$$line.total';
		if (f.field === 'totalAdjustment')
			return { $multiply: ['$$line.priceAdjustment', '$$line.quantity'] };
		const match =
			/^(quantity|unitPrice|originalUnitPrice|priceAdjustment)(Piece|Kg|G)$/.exec(
				f.field,
			);
		if (!match) return null;
		const target =
			match[2] === 'Piece' ? 'piece' : match[2] === 'Kg' ? 'kg' : 'g';
		const unit = { $ifNull: ['$$line.quantityUnit', 'piece'] };
		const factor = {
			$cond: [
				{ $eq: [unit, target] },
				1,
				{ $cond: [{ $eq: [unit, 'g'] }, 0.001, 1000] },
			],
		};
		return {
			$cond: [
				target === 'piece'
					? { $eq: [unit, 'piece'] }
					: { $ne: [unit, 'piece'] },
				match[1] === 'quantity'
					? { $multiply: ['$$line.quantity', factor] }
					: { $divide: ['$$line.' + match[1], factor] },
				null,
			],
		};
	};
	const groups = new Map<string, NumericFilter[]>();
	for (const f of filters.filter((f) => !(f.field in root))) {
		const key = (f.productType ?? '*') + ':' + (f.memoryGb ?? '*');
		groups.set(key, [...(groups.get(key) ?? []), f]);
	}
	return {
		$and: [
			...filters
				.filter((f) => f.field in root)
				.map((f) => predicate(f, root[f.field])),
			...[...groups.values()].map((group) => ({
				$anyElementTrue: [
					{
						$map: {
							input: '$lines',
							as: 'line',
							in: {
								$and: [
									...(group[0].productType
										? [{ $eq: ['$$line.type', group[0].productType] }]
										: []),
									...(group[0].memoryGb === undefined
										? []
										: [{ $eq: ['$$line.memoryGb', group[0].memoryGb] }]),
									...group.map((f) => predicate(f, lineValue(f))),
								],
							},
						},
					},
				],
			})),
		],
	};
}
