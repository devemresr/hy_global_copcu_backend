import type { SupplierSale } from '../services/stock.service';
import {
	loadPartyDirectory,
	preserveLegacyPartyLinks,
} from '../services/partyIdentity.service';
import {
	financeLedger,
	dailyFinanceTotals,
} from '../services/financeLedger.service';
import { normalizeBayiPhone } from '../util/bayiPhone';
import { Investor } from '../models/Investor';
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

const group = z.enum(FINANCE_GROUPS, {
	errorMap: () => ({ message: 'Geçerli bir işlem kaynağı seçin.' }),
});
const day = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, 'Geçerli bir işlem tarihi seçin.')
	.refine(
		(value) =>
			!Number.isNaN(Date.parse(value)) &&
			new Date(value).toISOString().slice(0, 10) === value,
		'Geçerli bir işlem tarihi seçin.',
	);
const categorySchema = z
	.object({
		requestId: z.string().uuid(),
		group: z.enum(['other', 'investment'], {
			errorMap: () => ({ message: 'Ana tür olarak Gelir veya Gider seçin.' }),
		}),
		name: z
			.string({
				required_error: 'Alt tür adını girin.',
				invalid_type_error: 'Geçerli bir alt tür adı girin.',
			})
			.trim()
			.min(1, 'Alt tür adını girin.')
			.max(100, 'Alt tür adı en fazla 100 karakter olabilir.'),
	})
	.strict();
const entrySchema = z
	.object({
		requestId: z.string().uuid(),
		categoryId: z
			.string({
				required_error: 'Gelir / gider türünü seçin.',
				invalid_type_error: 'Geçerli bir gelir / gider türü seçin.',
			})
			.min(1, 'Gelir / gider türünü seçin.')
			.max(100, 'Geçerli bir gelir / gider türü seçin.'),
		amount: z
			.number({
				required_error: 'Tutar alanına sıfırdan büyük bir değer girin.',
				invalid_type_error: 'Geçerli bir tutar girin.',
			})
			.finite('Geçerli bir tutar girin.')
			.positive('Tutar alanına sıfırdan büyük bir değer girin.')
			.max(1e12, 'Tutar en fazla 1.000.000.000.000 TL olabilir.')
			.multipleOf(0.01, 'Tutar en fazla iki ondalık basamak içerebilir.'),
		date: day,
		description: z
			.string()
			.trim()
			.max(500, 'Açıklama en fazla 500 karakter olabilir.')
			.default(''),
		investorId: z.string().uuid('Geçerli bir yatırımcı seçin.').optional(),
	})
	.strict();
const selectionSchema = z.object({
	investorId: z.string().uuid().optional(),
	group: group.optional(),
	direction: z
		.enum(['income', 'expense'], {
			errorMap: () => ({ message: 'Ana tür olarak Gelir veya Gider seçin.' }),
		})
		.optional(),
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
	{ _id: 'system:other', group: 'other', name: 'Diğer' },
	{ _id: 'system:sale', group: 'sale', name: 'Ürün satışı' },
	{ _id: 'system:investment', group: 'investment', name: 'Yatırım' },
] as const;
async function categories() {
	const stored = await FinanceCategory.find().select('group name').lean();
	return [
		...defaults.filter(
			(category) => !stored.some((row) => row._id === category._id),
		),
		...stored,
	];
}
async function actor(req: Request) {
	const adminId = requireUserId(req);
	const user = await User.findById(adminId).select('username').lean();
	if (!user) throw new UnauthorizedError();
	return { adminId, adminUsername: user.username };
}
function parse<S extends z.ZodTypeAny>(
	schema: S,
	input: unknown,
	nameLabel = 'Alt tür',
): z.output<S> {
	const result = schema.safeParse(input);
	if (!result.success)
		throw new ValidationError(
			[
				...new Set(
					result.error.issues.map((issue) => {
						const labels: Record<string, string> = {
							group: 'Ana tür olarak Gelir veya Gider seçin.',
							categoryId: 'Gelir / gider türünü seçin.',
							name: nameLabel + ' adını girin.',
							amount: 'Geçerli ve sıfırdan büyük bir tutar girin.',
							date: 'Geçerli bir işlem tarihi seçin.',
							investorId: 'Geçerli bir yatırımcı seçin.',
							requestId:
								'İşlem kimliği geçersiz. Sayfayı yenileyip tekrar deneyin.',
						};
						return issue.code === 'invalid_type' ||
							(issue.code === 'invalid_string' && issue.path[0] === 'requestId')
							? (labels[String(issue.path[0])] ?? issue.message)
							: issue.message;
					}),
				),
			].join(' '),
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
		const [purchase, sales, legacy, manual, subtypes, parties] =
			await Promise.all([
				Order.find().select('name bayiId bayiPhone total createdAt').lean(),
				StockRestock.find()
					.select('requestId totalRevenue createdAt lines.suppliers')
					.lean(),
				StockSale.find().select('requestId revenue createdAt').lean(),
				FinanceEntry.find({ voidedAt: null }).lean(),
				categories(),
				loadPartyDirectory(),
			]);
		const rows = financeLedger([
			...purchase.map((row) => ({
				id: `purchase:${row._id}`,
				source: 'purchase',
				...parties.purchases.get(String(row._id)),
				group: 'purchase',
				categoryId: 'system:purchase',
				subtype: 'Ürün alımı',
				amountCents: Math.round(row.total * 100),
				date: dateLabel(row.createdAt),
				sequence: row.createdAt.getTime(),
				description: row.name ?? '',
				editable: false,
			})),
			...sales.map((row) => ({
				id: `sale:${row.requestId}`,
				supplierSales: row.lines.flatMap((line) => line.suppliers ?? []),
				source: 'sale',
				group: 'sale',
				categoryId: 'system:sale',
				subtype: 'Ürün satışı',
				amountCents: Math.round(row.totalRevenue * 100),
				date: dateLabel(row.createdAt),
				sequence: row.createdAt.getTime(),
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
				sequence: row.createdAt.getTime(),
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
				sequence: row.createdAt.getTime(),
				description: row.description ?? '',
				investorId: parties.investor.resolve({
					id: row.investorId,
					name: row.investorName,
					phone: row.investorPhone,
					createdAt: row.createdAt,
				}),
				currentInvestorName: parties.investor.currentName(
					parties.investor.resolve({
						id: row.investorId,
						name: row.investorName,
						phone: row.investorPhone,
						createdAt: row.createdAt,
					}),
				),
				investorName: row.investorName ?? null,
				editable: true,
			})),
		]);
		const bayiIds = query.bayiIds?.length
			? query.bayiIds
			: query.bayiId
				? [query.bayiId]
				: [];
		const showRunningBalance =
			!selection.investorId &&
			!bayiIds.length &&
			!query.bayiName &&
			!selection.direction &&
			!selection.group &&
			!selection.categoryId &&
			!query.numericFilters?.length &&
			query.minTotal === undefined &&
			query.maxTotal === undefined;
		const signed = (row: (typeof rows)[number]) =>
			expense(row.group) ? -row.amountCents : row.amountCents;
		const matching = rows
			.flatMap((row) => {
				if (!bayiIds.length || !('supplierSales' in row)) return [row];
				const parts = (row.supplierSales as SupplierSale[]).filter(
					(part) => part.bayiId && bayiIds.includes(part.bayiId),
				);
				if (!parts.length) return [];
				return [
					{
						...row,
						bayiId: parts.length === 1 ? parts[0].bayiId : undefined,
						matchedBayiIds: parts.map((part) => part.bayiId),
						bayiName: parts[0].bayiName,
						currentBayiName: parts
							.map(
								(part) =>
									parties.bayi.currentName(part.bayiId) ?? part.bayiName,
							)
							.join(', '),
						amountCents: parts.reduce(
							(sum, part) => sum + Math.round(part.revenue * 100),
							0,
						),
					},
				];
			})
			.filter(
				(row) =>
					(!selection.investorId ||
						('investorId' in row && row.investorId === selection.investorId)) &&
					(!bayiIds.length ||
						('bayiId' in row &&
							typeof row.bayiId === 'string' &&
							bayiIds.includes(row.bayiId)) ||
						('matchedBayiIds' in row &&
							Array.isArray(row.matchedBayiIds) &&
							row.matchedBayiIds.some((id) => bayiIds.includes(id)))) &&
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
			.sort(
				(a, b) =>
					b.date.localeCompare(a.date) ||
					b.sequence - a.sequence ||
					b.id.localeCompare(a.id),
			);
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
			showRunningBalance,
			daily: dailyFinanceTotals(filtered),
			entries: filtered
				.slice((query.page - 1) * query.pageSize, query.page * query.pageSize)
				.map(
					({
						amountCents,
						sequence: _sequence,
						balanceBefore,
						balanceAfter,
						...row
					}) => ({
						...row,
						amount: amountCents / 100,
						...(showRunningBalance ? { balanceBefore, balanceAfter } : {}),
						direction: expense(row.group) ? 'expense' : 'income',
					}),
				),
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
async function saveCategory(req: Request, res: Response, update: boolean) {
	try {
		const input = parse(categorySchema, req.body),
			user = await actor(req);
		const name = input.name.normalize('NFKC').replace(/\s+/gu, ' ').trim(),
			nameKey = name.toLocaleLowerCase('tr-TR');
		if (!name || ['gelir', 'gider'].includes(nameKey))
			throw new ValidationError(
				'Alt tür için Gelir ve Gider dışında bir ad girin.',
			);
		const id = update
			? parse(
					z.union([
						z.string().uuid(),
						z.enum(['system:other', 'system:investment']),
					]),
					req.params.id,
				)
			: input.requestId;
		const available = await categories();
		const previous = available.find((category) => category._id === id);
		if (update && !previous)
			throw new ValidationError(
				'Düzenlenecek gelir / gider türü bulunamadı. Listeyi yenileyin.',
			);
		if (!update && previous) {
			if (
				previous.group !== input.group ||
				previous.name.toLocaleLowerCase('tr-TR') !== nameKey
			)
				throw new ConflictError(
					'Bu kayıt başka bir gelir / gider türü için kullanılmış. Pencereyi kapatıp tekrar açın.',
				);
			res.json({ category: previous });
			return;
		}
		if (
			update &&
			previous?.group !== input.group &&
			(id.startsWith('system:') ||
				(await FinanceEntry.exists({ categoryId: id })))
		)
			throw new ValidationError(
				'Kayıtlarda kullanılan bir tür Gelir ile Gider arasında taşınamaz.',
			);
		if (
			available.some(
				(category) =>
					category._id !== id &&
					['other', 'investment'].includes(category.group) &&
					category.name.toLocaleLowerCase('tr-TR') === nameKey,
			)
		)
			throw new ConflictError(
				'Bu adla bir gelir / gider türü zaten var. Farklı bir alt tür adı girin.',
			);
		const category = update
			? await FinanceCategory.findOneAndUpdate(
					{ _id: id },
					{
						$set: { group: input.group, name, nameKey },
						$setOnInsert: { createdBy: user.adminId },
					},
					{ upsert: true, returnDocument: 'after', runValidators: true },
				)
			: await FinanceCategory.create({
					_id: id,
					group: input.group,
					name,
					nameKey,
					createdBy: user.adminId,
				});
		await recordLogEvent({
			...user,
			action: update
				? LOG_ACTIONS.FINANCE_CATEGORY_UPDATE
				: LOG_ACTIONS.FINANCE_CATEGORY_CREATE,
			entityType: LOG_ENTITY_TYPES.FINANCE_CATEGORY,
			entityId: null,
			entityKey: name,
			fields: [
				{
					field: 'group',
					previousValue: previous?.group ?? null,
					newValue: input.group,
				},
				{
					field: 'name',
					previousValue: previous?.name ?? null,
					newValue: name,
				},
			],
		});
		res.status(update ? 200 : 201).json({ category });
	} catch (error) {
		handleFinanceError(error, res);
	}
}
export const createCategory = (req: Request, res: Response) =>
	saveCategory(req, res, false);
export const updateCategory = (req: Request, res: Response) =>
	saveCategory(req, res, true);
export const createEntry = async (req: Request, res: Response) => {
	try {
		const input = parse(entrySchema, req.body),
			user = await actor(req);
		const category = (await categories()).find(
			(category) => category._id === input.categoryId,
		);
		if (!category)
			throw new ValidationError('Geçerli bir gelir / gider türü seçin.');
		if (category.group === 'purchase' || category.group === 'sale')
			throw new ValidationError(
				'Ürün alış ve satışları yalnızca Alış ve Satış sayfalarından kaydedilebilir.',
			);
		if (input.investorId && category.group !== 'investment')
			throw new ValidationError(
				'Yatırımcı yalnızca Gelir ana türündeki kayıtlarda seçilebilir.',
			);
		const investor = input.investorId
			? await Investor.findById(input.investorId).lean()
			: null;
		if (input.investorId && !investor)
			throw new ValidationError('Geçerli bir yatırımcı seçin.');
		if (investor && !investor.phone)
			throw new ValidationError('Yatırımcıya önce telefon numarası ekleyin.');
		const existing = await FinanceEntry.findById(input.requestId).lean();
		if (existing) {
			if (
				existing.categoryId !== input.categoryId ||
				(existing.investorId ?? null) !== (input.investorId ?? null) ||
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
			investorId: investor?._id ?? null,
			investorName: investor?.name ?? null,
			investorPhone: investor?.phone ?? null,
			createdBy: user.adminId,
		});
		await recordLogEvent({
			...user,
			action: LOG_ACTIONS.FINANCE_ENTRY_CREATE,
			entityType: LOG_ENTITY_TYPES.FINANCE_ENTRY,
			investorId: investor?._id ?? null,
			investorName: investor?.name ?? null,
			entityId: null,
			entityKey: `${category.name} · ${input.date}`,
			fields: [
				{ field: 'amount', previousValue: null, newValue: input.amount },
				{
					field: 'investor',
					previousValue: null,
					newValue: investor?.name ?? null,
				},
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
				investorId: entry.investorId,
				investorName: entry.investorName,
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

const investorSchema = z
	.object({
		requestId: z.string().uuid(),
		name: z.string().trim().min(1).max(120),
		phone: z
			.string()
			.max(64)
			.transform(normalizeBayiPhone)
			.refine(Boolean, 'Geçerli bir telefon numarası girin.'),
	})
	.strict();
export const getInvestors = async (_req: Request, res: Response) => {
	try {
		res.json({
			investors: await Investor.find()
				.select('name phone')
				.sort({ name: 1 })
				.lean(),
		});
	} catch (error) {
		handleFinanceError(error, res);
	}
};
async function saveInvestor(req: Request, res: Response, update: boolean) {
	try {
		const input = parse(investorSchema, req.body, 'Yatırımcı'),
			user = await actor(req);
		const name = input.name.normalize('NFKC').replace(/\s+/gu, ' ').trim();
		if (!name) throw new ValidationError('Yatırımcı adı girin.');
		const nameKey = name.toLocaleLowerCase('tr-TR');
		const id = update
			? parse(z.string().uuid(), req.params.id)
			: input.requestId;
		const previous = await Investor.findById(id).lean();
		if (update && !previous) throw new ValidationError('Yatırımcı bulunamadı.');
		if (!update && previous) {
			if (previous.nameKey !== nameKey || previous.phone !== input.phone)
				throw new ConflictError(
					'Bu işlem kimliği farklı bir yatırımcıda kullanıldı.',
				);
			res.json({ investor: previous, existing: true });
			return;
		}
		const matches = await Investor.find({
			_id: { $ne: id },
			$or: [{ nameKey }, { phone: input.phone }],
		}).lean();
		if (matches.length) {
			if (!update && matches.length === 1) {
				res.json({ investor: matches[0], existing: true });
				return;
			}
			throw new ConflictError(
				'Bu ad veya telefon numarası başka bir yatırımcıda kayıtlı.',
			);
		}
		if (update) await preserveLegacyPartyLinks('investor', id);
		let investor;
		try {
			investor = update
				? await Investor.findByIdAndUpdate(
						id,
						{ name, nameKey, phone: input.phone },
						{ returnDocument: 'after', runValidators: true },
					)
				: await Investor.create({
						_id: id,
						name,
						nameKey,
						phone: input.phone,
						createdBy: user.adminId,
					});
		} catch (error) {
			if (
				typeof error === 'object' &&
				error &&
				'code' in error &&
				error.code === 11000
			)
				throw new ConflictError(
					'Bu ad veya telefon numarası başka bir yatırımcıda kayıtlı.',
				);
			throw error;
		}
		await recordLogEvent({
			...user,
			action: update
				? LOG_ACTIONS.INVESTOR_UPDATE
				: LOG_ACTIONS.INVESTOR_CREATE,
			entityType: LOG_ENTITY_TYPES.INVESTOR,
			investorId: String(investor!._id),
			investorName: name,
			entityId: null,
			entityKey: name,
			fields: [
				{
					field: 'name',
					previousValue: previous?.name ?? null,
					newValue: name,
				},
				{
					field: 'phone',
					previousValue: previous?.phone ?? null,
					newValue: input.phone,
				},
			],
		});
		res.status(update ? 200 : 201).json({ investor, existing: false });
	} catch (error) {
		handleFinanceError(error, res);
	}
}
export const createInvestor = (req: Request, res: Response) =>
	saveInvestor(req, res, false);
export const updateInvestor = (req: Request, res: Response) =>
	saveInvestor(req, res, true);
