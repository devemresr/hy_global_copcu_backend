import { matchesNumeric } from '../schemas/numericFilters.schema';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
	FINANCE_GROUPS,
	FinanceCategory,
	FinanceEntry,
} from '../models/Finance';
import { Order } from '../models/Order';
import { StockSale } from '../models/StockSale';
import { StockRestock } from '../models/StockRestock';
import { User } from '../models/User';
import { requireUserId } from './auth.helper';
import { orderQuerySchema } from '../schemas/order.schema';
import {
	ConflictError,
	UnauthorizedError,
	ValidationError,
} from '../errors/HttpError';
import { handleHttpError } from '../errors/handleHttpError';
import { recordLogEvent } from '../services/logEvents/recordLogEvent.service';
import { LOG_ACTIONS, LOG_ENTITY_TYPES } from '../models/LogEvent';
import logger from '../util/logger';

const group = z.enum(FINANCE_GROUPS);
const day = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/)
	.refine(
		(value) =>
			!Number.isNaN(Date.parse(value)) &&
			new Date(value).toISOString().slice(0, 10) === value,
	);
const categorySchema = z
	.object({
		requestId: z.string().uuid(),
		group,
		name: z.string().trim().min(1).max(100),
	})
	.strict();
const entrySchema = z
	.object({
		requestId: z.string().uuid(),
		categoryId: z.string().min(1).max(100),
		amount: z.number().finite().positive().max(1e12).multipleOf(0.01),
		date: day,
		description: z.string().trim().max(500).default(''),
	})
	.strict();
const selectionSchema = z.object({
	group: group.optional(),
	direction: z.enum(['income', 'expense']).optional(),
	categoryId: z.string().max(100).optional(),
});
function handleFinanceError(error: unknown, res: Response) {
	if (
		error &&
		typeof error === 'object' &&
		'code' in error &&
		error.code === 11000
	)
		return handleHttpError(
			new ConflictError(
				'Bu kayıt zaten var. Kayıtları yenileyip tekrar deneyin.',
			),
			res,
			logger,
		);
	return handleHttpError(error, res, logger);
}
const expense = (group: string) => group === 'purchase' || group === 'other';
const defaults = [
	{ _id: 'system:purchase', group: 'purchase', name: 'Ürün alımı' },
	{ _id: 'system:other', group: 'other', name: 'Genel gider' },
	{ _id: 'system:sale', group: 'sale', name: 'Ürün satışı' },
	{ _id: 'system:investment', group: 'investment', name: 'Sermaye girişi' },
] as const;
async function categories() {
	return [
		...defaults,
		...(await FinanceCategory.find().select('group name').lean()),
	];
}
async function actor(req: Request) {
	const adminId = requireUserId(req);
	const user = await User.findById(adminId).select('username').lean();
	if (!user) throw new UnauthorizedError();
	return { adminId, adminUsername: user.username };
}
function parse<S extends z.ZodTypeAny>(schema: S, input: unknown): z.output<S> {
	const result = schema.safeParse(input);
	if (!result.success)
		throw new ValidationError(
			result.error.issues.map((issue) => issue.message).join(' '),
		);
	return result.data;
}
function dateLabel(value: Date) {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Europe/Istanbul',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).formatToParts(value);
	const part = (type: string) =>
		parts.find((entry) => entry.type === type)!.value;
	return `${part('year')}-${part('month')}-${part('day')}`;
}
export const getFinance = async (req: Request, res: Response) => {
	try {
		const query = parse(orderQuerySchema, req.query),
			selection = parse(selectionSchema, req.query);
		if (query.numericFilters?.some((f) => f.field !== 'total'))
			throw new ValidationError(
				'Bakiye için yalnızca işlem tutarı filtrelenebilir.',
			);
		const [purchase, sales, legacy, manual, subtypes] = await Promise.all([
			Order.find().select('name total createdAt').lean(),
			StockRestock.find().select('requestId totalRevenue createdAt').lean(),
			StockSale.find().select('requestId revenue createdAt').lean(),
			FinanceEntry.find({ voidedAt: null }).lean(),
			categories(),
		]);
		const rows = [
			...purchase.map((row) => ({
				id: `purchase:${row._id}`,
				source: 'purchase',
				group: 'purchase',
				categoryId: 'system:purchase',
				subtype: 'Ürün alımı',
				amountCents: Math.round(row.total * 100),
				date: dateLabel(row.createdAt),
				description: row.name ?? '',
				editable: false,
			})),
			...sales.map((row) => ({
				id: `sale:${row.requestId}`,
				source: 'sale',
				group: 'sale',
				categoryId: 'system:sale',
				subtype: 'Ürün satışı',
				amountCents: Math.round(row.totalRevenue * 100),
				date: dateLabel(row.createdAt),
				description: 'Stok satışı',
				editable: false,
			})),
			...legacy.map((row) => ({
				id: `legacy-sale:${row.requestId}`,
				source: 'sale',
				group: 'sale',
				categoryId: 'system:sale',
				subtype: 'Ürün satışı',
				amountCents: Math.round(row.revenue * 100),
				date: dateLabel(row.createdAt),
				description: 'Stok satışı',
				editable: false,
			})),
			...manual.map((row) => ({
				id: row._id!,
				source: 'manual',
				group: row.group,
				categoryId: row.categoryId,
				subtype: row.subtype,
				amountCents: row.amountCents,
				date: row.date,
				description: row.description ?? '',
				editable: true,
			})),
		];
		const signed = (row: (typeof rows)[number]) =>
			expense(row.group) ? -row.amountCents : row.amountCents;
		const matching = rows.filter(
			(row) =>
				matchesNumeric(query.numericFilters, {
					total: row.amountCents / 100,
				}) &&
				(!selection.group || row.group === selection.group) &&
				(!selection.categoryId || row.categoryId === selection.categoryId) &&
				(!selection.direction ||
					selection.direction ===
						(expense(row.group) ? 'expense' : 'income')) &&
				(query.minTotal === undefined ||
					row.amountCents >= Math.round(query.minTotal * 100)) &&
				(query.maxTotal === undefined ||
					row.amountCents <= Math.round(query.maxTotal * 100)),
		);
		const filtered = matching
			.filter(
				(row) =>
					(!query.from || row.date >= query.from) &&
					(!query.until || row.date <= query.until),
			)
			.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
		const openingFrom = query.from;
		const opening = openingFrom
			? matching
					.filter((row) => row.date < openingFrom)
					.reduce((sum, row) => sum + signed(row), 0)
			: 0;
		const income = filtered
				.filter((row) => !expense(row.group))
				.reduce((sum, row) => sum + row.amountCents, 0),
			expenses = filtered
				.filter((row) => expense(row.group))
				.reduce((sum, row) => sum + row.amountCents, 0);
		res.json({
			categories: subtypes,
			entries: filtered
				.slice((query.page - 1) * query.pageSize, query.page * query.pageSize)
				.map(({ amountCents, ...row }) => ({
					...row,
					amount: amountCents / 100,
					direction: expense(row.group) ? 'expense' : 'income',
				})),
			count: filtered.length,
			totalPages: Math.max(1, Math.ceil(filtered.length / query.pageSize)),
			income: income / 100,
			expenses: expenses / 100,
			net: (income - expenses) / 100,
			openingBalance: opening / 100,
			closingBalance: (opening + income - expenses) / 100,
			balance: rows.reduce((sum, row) => sum + signed(row), 0) / 100,
		});
	} catch (error) {
		handleFinanceError(error, res);
	}
};
export const createCategory = async (req: Request, res: Response) => {
	try {
		const input = parse(categorySchema, req.body),
			user = await actor(req);
		const name = input.name.normalize('NFKC').replace(/\s+/gu, ' '),
			nameKey = name.toLocaleLowerCase('tr-TR');
		const existing = await FinanceCategory.findById(input.requestId).lean();
		if (existing) {
			if (existing.group !== input.group || existing.nameKey !== nameKey)
				throw new ConflictError(
					'Bu işlem kimliği farklı bir alt türde kullanıldı.',
				);
			res.json({ category: existing });
			return;
		}
		if (
			defaults.some(
				(category) =>
					category.group === input.group &&
					category.name.toLocaleLowerCase('tr-TR') === nameKey,
			) ||
			(await FinanceCategory.exists({ group: input.group, nameKey }))
		)
			throw new ConflictError('Bu alt tür zaten var.');
		const category = await FinanceCategory.create({
			_id: input.requestId,
			group: input.group,
			name,
			nameKey,
			createdBy: user.adminId,
		});
		await recordLogEvent({
			...user,
			action: LOG_ACTIONS.FINANCE_CATEGORY_CREATE,
			entityType: LOG_ENTITY_TYPES.FINANCE_CATEGORY,
			entityId: null,
			entityKey: name,
			fields: [{ field: 'group', previousValue: null, newValue: input.group }],
		});
		res.status(201).json({ category });
	} catch (error) {
		handleFinanceError(error, res);
	}
};
export const createEntry = async (req: Request, res: Response) => {
	try {
		const input = parse(entrySchema, req.body),
			user = await actor(req);
		const category = (await categories()).find(
			(category) => category._id === input.categoryId,
		);
		if (!category) throw new ValidationError('Bir alt tür seçin.');
		const existing = await FinanceEntry.findById(input.requestId).lean();
		if (existing) {
			if (
				existing.categoryId !== input.categoryId ||
				existing.amountCents !== Math.round(input.amount * 100) ||
				existing.date !== input.date ||
				existing.description !== input.description
			)
				throw new ConflictError(
					'Bu işlem kimliği farklı bir kayıtta kullanıldı.',
				);
			res.json({ entry: existing });
			return;
		}
		const entry = await FinanceEntry.create({
			_id: input.requestId,
			categoryId: input.categoryId,
			group: category.group,
			subtype: category.name,
			amountCents: Math.round(input.amount * 100),
			date: input.date,
			description: input.description,
			createdBy: user.adminId,
		});
		await recordLogEvent({
			...user,
			action: LOG_ACTIONS.FINANCE_ENTRY_CREATE,
			entityType: LOG_ENTITY_TYPES.FINANCE_ENTRY,
			entityId: null,
			entityKey: `${category.name} · ${input.date}`,
			fields: [
				{ field: 'amount', previousValue: null, newValue: input.amount },
				{
					field: 'description',
					previousValue: null,
					newValue: input.description,
				},
			],
		});
		res.status(201).json({ entry });
	} catch (error) {
		handleFinanceError(error, res);
	}
};
export const voidEntry = async (req: Request, res: Response) => {
	try {
		const id = parse(z.string().uuid(), req.params.id),
			user = await actor(req);
		const entry = await FinanceEntry.findOneAndUpdate(
			{ _id: id, voidedAt: null },
			{ $set: { voidedAt: new Date() } },
			{ returnDocument: 'before' },
		).lean();
		if (entry)
			await recordLogEvent({
				...user,
				action: LOG_ACTIONS.FINANCE_ENTRY_VOID,
				entityType: LOG_ENTITY_TYPES.FINANCE_ENTRY,
				entityId: null,
				entityKey: `${entry.subtype} · ${entry.date}`,
				fields: [
					{
						field: 'amount',
						previousValue: entry.amountCents / 100,
						newValue: null,
					},
				],
			});
		res.json({ success: true });
	} catch (error) {
		handleFinanceError(error, res);
	}
};
