import { z } from 'zod';
import {
	ORDER_PRODUCT_TYPES,
	ORDER_QUANTITY_UNITS,
} from '../constants/orderProducts.constant';

export const orderLineSchema = z
	.object({
		type: z.enum(['EMCP', 'EMMC', 'IPHONE', 'TABLET']),
		quantity: z.number().finite().positive().max(1_000_000).multipleOf(0.001),
		quantityUnit: z.enum(ORDER_QUANTITY_UNITS).default('piece'),
		unitPriceOverride: z
			.number()
			.finite()
			.min(0)
			.max(1_000_000)
			.multipleOf(0.01)
			.optional(),
		manualListPrice: z
			.number()
			.finite()
			.min(0)
			.max(1_000_000)
			.multipleOf(0.01)
			.optional(),
		memoryGb: z
			.number()
			.int()
			.min(8)
			.max(1024)
			.refine((n) => Number.isInteger(Math.log2(n)))
			.nullable()
			.optional(),
	})
	.strict()
	.superRefine((line, context) => {
		if (
			ORDER_PRODUCT_TYPES[line.type].requiresMemorySize &&
			line.quantityUnit !== 'piece'
		)
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['quantityUnit'],
				message: 'Bellek ürünleri adet ile takip edilir.',
			});
		if (
			ORDER_PRODUCT_TYPES[line.type].requiresMemorySize &&
			line.memoryGb == null
		)
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['memoryGb'],
				message: 'Bu ürün için bellek boyutu seçin.',
			});
		if (
			!ORDER_PRODUCT_TYPES[line.type].requiresMemorySize &&
			line.memoryGb != null
		)
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['memoryGb'],
				message: 'Bu ürün bellek boyutu kullanmıyor.',
			});
		if (line.quantityUnit === 'piece' && !Number.isInteger(line.quantity))
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['quantity'],
				message: 'Adet tam sayı olmalıdır.',
			});
	});
export const createOrderSchema = z
	.object({
		bayiId: z.string().regex(/^[a-f\d]{24}$/i, 'Bir bayi seçin.'),
		lines: z.array(orderLineSchema).min(1).max(200),
	})
	.strict();
const date = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/)
	.refine(
		(s) =>
			!Number.isNaN(Date.parse(s)) &&
			new Date(s).toISOString().slice(0, 10) === s,
	);
export const orderQuerySchema = z
	.object({
		bayiName: z.string().trim().max(120).optional(),
		excludeIds: z
			.string()
			.regex(/^[a-f\d]{24}(,[a-f\d]{24})*$/i)
			.transform((value) => value.split(','))
			.optional(),
		from: date.optional(),
		until: date.optional(),
		minTotal: z.coerce.number().finite().min(0).max(1e15).optional(),
		maxTotal: z.coerce.number().finite().min(0).max(1e15).optional(),
		page: z.coerce.number().int().min(1).max(1_000_000).default(1),
		pageSize: z.coerce.number().int().min(1).max(100).default(20),
	})
	.refine(
		(v) => !v.from || !v.until || v.from <= v.until,
		'Başlangıç tarihi bitişten sonra olamaz.',
	)
	.refine(
		(v) =>
			v.minTotal === undefined ||
			v.maxTotal === undefined ||
			v.minTotal <= v.maxTotal,
		'Fiyat aralığı geçersiz.',
	);
