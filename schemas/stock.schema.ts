import { z } from 'zod';
import { ORDER_PRODUCT_TYPES } from '../constants/orderProducts.constant';

const product = {
	type: z.enum(['EMCP', 'EMMC', 'IPHONE', 'TABLET']),
	memoryGb: z
		.number()
		.int()
		.min(8)
		.max(1024)
		.refine((n) => Number.isInteger(Math.log2(n)))
		.nullable()
		.default(null),
	quantityUnit: z.enum(['piece', 'kg', 'g']).default('piece'),
};
function validateProduct(
	value: {
		type: keyof typeof ORDER_PRODUCT_TYPES;
		memoryGb: number | null;
		quantityUnit: string;
	},
	context: z.RefinementCtx,
) {
	if (
		ORDER_PRODUCT_TYPES[value.type].requiresMemorySize !==
		(value.memoryGb !== null)
	)
		context.addIssue({
			code: 'custom',
			path: ['memoryGb'],
			message: 'Ürüne uygun bellek boyutunu seçin.',
		});
	if (
		ORDER_PRODUCT_TYPES[value.type].requiresMemorySize &&
		value.quantityUnit !== 'piece'
	)
		context.addIssue({
			code: 'custom',
			path: ['quantityUnit'],
			message: 'Bellek ürünleri adet ile takip edilir.',
		});
}
const restockLineSchema = z
	.object({
		...product,
		quantity: z.number().finite().positive().max(1_000_000).multipleOf(0.001),
		revenue: z.number().finite().min(0).max(1e12).multipleOf(0.01),
	})
	.strict()
	.superRefine((value, context) => {
		validateProduct(value, context);
		if (value.quantityUnit === 'piece' && !Number.isInteger(value.quantity))
			context.addIssue({
				code: 'custom',
				path: ['quantity'],
				message: 'Adet tam sayı olmalıdır.',
			});
	});
export const stockSaleSchema = z
	.object({
		requestId: z.string().uuid(),
		mode: z.enum(['complete', 'partial']),
		lines: z
			.array(restockLineSchema)
			.min(1, 'En az bir ürün ekleyin.')
			.max(200),
	})
	.strict()
	.superRefine((value, context) => {
		const keys = value.lines.map(
			(line) =>
				`${line.type}:${line.memoryGb ?? '-'}:${line.quantityUnit === 'piece' ? 'piece' : 'kg'}`,
		);
		if (new Set(keys).size !== keys.length)
			context.addIssue({
				code: 'custom',
				path: ['lines'],
				message:
					'Aynı ürünü bir kez ekleyin; miktarını aynı satırda düzenleyin.',
			});
	});
export const purchaseWarningSchema = z
	.object({
		bayiId: z.string().regex(/^[a-f\d]{24}$/i),
		lines: z
			.array(
				z
					.object({
						...product,
						unitPrice: z
							.number()
							.finite()
							.min(0)
							.max(1_000_000)
							.multipleOf(0.01),
					})
					.strict()
					.superRefine(validateProduct),
			)
			.min(1)
			.max(200),
	})
	.strict();
export type StockSaleInput = z.infer<typeof stockSaleSchema>;
