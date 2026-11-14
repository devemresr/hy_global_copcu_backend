import { reportPeriodRange } from '../util/reportScheduleTime';
import { z } from 'zod';
import { orderQuerySchema } from './order.schema';
import { numericFieldsFor } from './numericFilters.schema';
import { ValidationError } from '../errors/HttpError';
import env from '../config/env';
import allowedOrigins from '../config/allowedOrigins';

export const analysisReportUrlSchema = z
	.string()
	.trim()
	.max(20000)
	.url(
		'http:// veya https:// ile başlayan geçerli bir Analiz bağlantısı girin.',
	)
	.superRefine((value, context) => {
		let url: URL;
		try {
			url = new URL(value);
		} catch {
			return;
		}
		if (
			!['http:', 'https:'].includes(url.protocol) ||
			url.username ||
			url.password ||
			!url.pathname.endsWith('/admin/analiz')
		) {
			context.addIssue({
				code: 'custom',
				message:
					'Analiz sayfasından kopyalanmış bir http(s) rapor bağlantısı girin.',
			});
		}
		if (
			env.NODE_ENV === 'production' &&
			!allowedOrigins
				.filter((origin) => origin.startsWith('https://'))
				.includes(url.origin)
		) {
			context.addIssue({
				code: 'custom',
				message: 'Rapor bağlantısı HY Global alan adına ait olmalıdır.',
			});
		}
	});

export const REPORT_PERIODS = [
	'today',
	'yesterday',
	'thisWeek',
	'lastWeek',
	'thisMonth',
	'lastMonth',
	'thisYear',
	'lastYear',
	'last7Days',
	'last30Days',
	'allTime',
] as const;
const extraFilters = z.object({
	movementType: z
		.enum([
			'all-movements',
			'purchase-entries',
			'all-sales',
			'full-stock-sales',
			'partial-sales',
		])
		.optional(),
	productType: z.enum(['EMMC', 'EMCP', 'IPHONE', 'TABLET']).optional(),
	memoryGb: z.number().int().min(8).max(1024).optional(),
	investorId: z.string().uuid().optional(),
	group: z.enum(['purchase', 'sale', 'other', 'investment']).optional(),
	direction: z.enum(['income', 'expense']).optional(),
	categoryId: z.string().max(100).optional(),
});
const knownFilters = new Set([
	'bayiName',
	'purchaseId',
	'bayiId',
	'bayiIds',
	'numericFilters',
	'from',
	'until',
	'minTotal',
	'maxTotal',
	...Object.keys(extraFilters.shape),
]);
const stringFields = [
	'from',
	'until',
	'bayiName',
	'bayiId',
	'purchaseId',
	'investorId',
	'categoryId',
	'group',
	'direction',
	'movementType',
	'productType',
] as const;
const numberFields = ['minTotal', 'maxTotal', 'memoryGb'] as const;
function hasAnalysisFilters(search: URLSearchParams) {
	return (
		search.has('filters') ||
		search.has('period') ||
		search.has('bayi') ||
		[...stringFields, ...numberFields].some((key) => search.has(key)) ||
		[...search.keys()].some((key) => /^(field|type|size|min|max)\d+$/.test(key))
	);
}
function readableFilters(search: URLSearchParams): Record<string, unknown> {
	const raw: Record<string, unknown> = {};
	const number = (key: string) => {
		const value = search.get(key)!;
		if (!value.trim()) throw new Error('Empty number');
		return Number(value);
	};
	for (const key of stringFields)
		if (search.has(key))
			raw[key] =
				key === 'productType'
					? search.get(key)!.toUpperCase()
					: search.get(key);
	for (const key of numberFields) if (search.has(key)) raw[key] = number(key);
	if (search.has('bayi')) raw.bayiIds = search.getAll('bayi');
	const indices = new Set<number>();
	for (const key of search.keys()) {
		const match = /^(field|type|size|min|max)(\d+)$/.exec(key);
		if (match) {
			const index = Number(match[2]);
			if (index < 1 || index > 30) throw new Error('Invalid condition');
			indices.add(index);
		}
	}
	if (indices.size)
		raw.numericFilters = [...indices]
			.sort((a, b) => a - b)
			.map((index) => ({
				field: search.get('field' + index),
				...(search.has('type' + index)
					? { productType: search.get('type' + index)!.toUpperCase() }
					: {}),
				...(search.has('size' + index)
					? { memoryGb: number('size' + index) }
					: {}),
				...(search.has('min' + index) ? { min: number('min' + index) } : {}),
				...(search.has('max' + index) ? { max: number('max' + index) } : {}),
			}));
	const period = search.get('period');
	if (period === 'allTime') {
		delete raw.from;
		delete raw.until;
	} else if (period && period !== 'custom') {
		const preset = REPORT_PERIODS.find((p) => p === period);
		if (!preset) throw new Error('Invalid period');
		Object.assign(raw, reportPeriodRange(preset));
	}
	return raw;
}

export function parseAnalysisReportUrl(value: string) {
	try {
		const url = new URL(analysisReportUrlSchema.parse(value));
		if (
			!['http:', 'https:'].includes(url.protocol) ||
			url.username ||
			url.password ||
			!url.pathname.endsWith('/admin/analiz') ||
			!hasAnalysisFilters(url.searchParams)
		)
			throw new Error();
		const preset = z
			.enum([
				'purchases',
				'sales',
				'stock',
				'bayis',
				'balance',
				'income',
				'expenses',
			])
			.parse(url.searchParams.get('preset'));
		const raw: unknown = url.searchParams.has('filters')
			? JSON.parse(url.searchParams.get('filters')!)
			: readableFilters(url.searchParams);
		if (
			!raw ||
			typeof raw !== 'object' ||
			Array.isArray(raw) ||
			Object.keys(raw).some((key) => !knownFilters.has(key))
		)
			throw new Error();
		const filters = z.intersection(orderQuerySchema, extraFilters).parse(raw);
		const kind =
			preset === 'purchases'
				? 'orders'
				: ['sales', 'stock', 'bayis'].includes(preset)
					? 'stock'
					: 'finance';
		if (
			filters.numericFilters?.some(
				(f) => !numericFieldsFor(kind).includes(f.field),
			)
		)
			throw new Error();
		const view = z
			.enum(['movements', 'profits', 'bayi'])
			.parse(
				url.searchParams.get('view') ??
					(preset === 'bayis' ? 'bayi' : 'movements'),
			);
		const groupBy = z
			.enum(['product', 'memory'])
			.parse(url.searchParams.get('groupBy') ?? 'product');
		return { preset, filters, view, groupBy };
	} catch {
		throw new ValidationError(
			'Analiz sayfasında “Rapor bağlantısını kopyala” ile oluşturulmuş geçerli bir bağlantı yapıştırın.',
		);
	}
}
export const reportScheduleSchema = z
	.object({
		name: z.string().trim().min(1, 'Rapor adını girin.').max(120),
		source: z.enum(['analysis', 'umami']).default('analysis'),
		analysisUrl: z.string().trim().max(20000).default(''),
		includeData: z.boolean().default(true),
		enabled: z.boolean(),
		includePdf: z.boolean(),
		// includeGraphs: z.boolean() is disabled until graphs are restored.
		frequency: z.enum(['daily', 'weekly', 'monthly']),
		time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
		weekday: z.number().int().min(0).max(6),
		monthDay: z.number().int().min(1).max(28),
		relativePeriod: z.enum(REPORT_PERIODS),
		recipients: z
			.array(
				z
					.string()
					.trim()
					.toLowerCase()
					.max(254)
					.email('Geçerli alıcı e-posta adresleri girin.'),
			)
			.max(20)
			.default([]),
	})
	.strict()
	.superRefine((value, context) => {
		if (value.source === 'analysis') {
			const result = analysisReportUrlSchema.safeParse(value.analysisUrl);
			if (!result.success)
				for (const issue of result.error.issues)
					context.addIssue({
						code: 'custom',
						path: ['analysisUrl'],
						message: issue.message,
					});
		}
	});
export type ReportScheduleInput = z.infer<typeof reportScheduleSchema>;
