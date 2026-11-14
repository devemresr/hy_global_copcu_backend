import { z } from '../util/zodTurkish';

const stockConversionLineSchema = z
	.object({
		sourceLotId: z.string().min(1).max(200),
		fromUnit: z.enum(['piece', 'kg', 'g']),
		fromQuantity: z.number().finite().positive().max(1_000_000),
		toUnit: z.enum(['piece', 'kg', 'g']),
		toQuantity: z.number().finite().positive().max(1_000_000),
	})
	.strict()
	.superRefine((value, context) => {
		if ((value.fromUnit === 'piece') === (value.toUnit === 'piece'))
			context.addIssue({
				code: 'custom',
				path: ['toUnit'],
				message:
					'Adet ile ağırlık arasında dönüşüm seçin. kg ve g aynı stok birimidir.',
			});
		for (const [unit, quantity, field] of [
			[value.fromUnit, value.fromQuantity, 'fromQuantity'],
			[value.toUnit, value.toQuantity, 'toQuantity'],
		] as const) {
			const step = unit === 'piece' ? 1 : unit === 'kg' ? 0.000001 : 0.001;
			if (!z.number().multipleOf(step).safeParse(quantity).success)
				context.addIssue({
					code: 'custom',
					path: [field],
					message:
						unit === 'piece'
							? 'Adet tam sayı olmalıdır.'
							: unit === 'kg'
								? 'kg için en fazla 6 ondalık basamak girin.'
								: 'g için en fazla 3 ondalık basamak girin.',
				});
		}
	});
export const stockConversionSchema = z
	.object({
		requestId: z.string().uuid(),
		lines: z.array(stockConversionLineSchema).min(1).max(100),
		note: z.string().trim().max(500).default(''),
	})
	.strict()
	.superRefine((value, context) => {
		if (
			new Set(value.lines.map((line) => line.sourceLotId)).size !==
			value.lines.length
		)
			context.addIssue({
				code: 'custom',
				path: ['lines'],
				message:
					'Aynı kaynak stok satırı bir işlemde yalnızca bir kez kullanılabilir.',
			});
	});
export type StockConversionInput = z.infer<typeof stockConversionSchema>;
export const storedStockConversionLineSchema = stockConversionLineSchema
	.innerType()
	.extend({
		orderId: z.string().min(1),
		bayiId: z.string().default(''),
		bayiName: z.string().default(''),
		type: z.enum(['EMMC', 'EMCP', 'IPHONE', 'TABLET']),
		memoryGb: z.number().nullable().default(null),
		sourceQuantity: z.number().positive(),
		targetQuantity: z.number().positive(),
		cost: z.number().finite().min(0),
	})
	// Stored documents also contain MongoDB and operation-level metadata.
	// Keep request validation strict, but project persisted records onto line fields.
	.strip();
