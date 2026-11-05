import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Bayi } from '../models/Bayi';
import { bayiInputSchema, normalizeBayiName } from '../schemas/bayi.schema';
import {
	ConflictError,
	NotFoundError,
	ValidationError,
} from '../errors/HttpError';
import { handleHttpError } from '../errors/handleHttpError';
import logger from '../util/logger';

const publicBayi = (bayi: {
	_id: Types.ObjectId;
	name: string;
	phone: string;
}) => ({ _id: bayi._id.toHexString(), name: bayi.name, phone: bayi.phone });

async function duplicateError(
	nameKey: string,
	phone: string,
	excludeId?: string,
) {
	const entries = await Bayi.find({
		$or: [{ nameKey }, { phone }],
		...(excludeId ? { _id: { $ne: new Types.ObjectId(excludeId) } } : {}),
	})
		.select('name phone +nameKey')
		.sort({ createdAt: 1, _id: 1 })
		.lean();
	const matches = entries
		.map((entry) => ({
			bayi: publicBayi(entry),
			fields: [
				...(entry.nameKey === nameKey ? ['name'] : []),
				...(entry.phone === phone ? ['phone'] : []),
			],
		}))
		.sort(
			(a, b) =>
				Number(b.fields.includes('name')) - Number(a.fields.includes('name')),
		);
	if (!matches.length) return null;
	const message = matches
		.map(
			(match) =>
				`${match.fields.map((field) => (field === 'name' ? 'Bu ad' : 'Bu telefon numarası')).join(' ve ')} zaten "${match.bayi.name}" (${match.bayi.phone}) bayisinde kayıtlı.`,
		)
		.join(' ');
	return new ConflictError(message, {
		matches,
		selectedBayiId: matches[0].bayi._id,
	});
}

export const listBayiler = async (
	_req: Request,
	res: Response,
): Promise<void> => {
	try {
		const bayiler = await Bayi.find().select('name phone').lean();
		res.json({
			bayiler: bayiler
				.map(publicBayi)
				.sort((a, b) => a.name.localeCompare(b.name, 'tr')),
		});
	} catch (error) {
		handleHttpError(error, res, logger);
	}
};

async function saveBayi(
	req: Request,
	res: Response,
	update: boolean,
): Promise<void> {
	let key: { nameKey: string; phone: string; id?: string } | undefined;
	try {
		const input = bayiInputSchema.safeParse(req.body);
		if (!input.success)
			throw new ValidationError(input.error.issues[0].message);
		const id = update ? String(req.params.id) : undefined;
		if (id && !/^[a-f\d]{24}$/i.test(id))
			throw new ValidationError('Geçersiz bayi kimliği.');
		if (id && !(await Bayi.exists({ _id: id })))
			throw new NotFoundError('Bayi');
		key = {
			nameKey: normalizeBayiName(input.data.name),
			phone: input.data.phone,
			id,
		};
		await Bayi.init();
		const duplicate = await duplicateError(key.nameKey, key.phone, id);
		if (duplicate) throw duplicate;
		const data = { ...input.data, nameKey: key.nameKey };
		const bayi = id
			? await Bayi.findByIdAndUpdate(id, data, {
					returnDocument: 'after',
					runValidators: true,
				})
			: await Bayi.create(data);
		if (!bayi) throw new NotFoundError('Bayi');
		res.status(update ? 200 : 201).json({ bayi: publicBayi(bayi) });
	} catch (error) {
		// Unique indexes also protect simultaneous requests. Return the same
		// selectable match if another request saved it after our first check.
		if (
			key &&
			typeof error === 'object' &&
			error !== null &&
			'code' in error &&
			error.code === 11000
		) {
			try {
				const duplicate = await duplicateError(key.nameKey, key.phone, key.id);
				if (duplicate) {
					handleHttpError(duplicate, res, logger);
					return;
				}
			} catch (lookupError) {
				handleHttpError(lookupError, res, logger);
				return;
			}
		}
		handleHttpError(error, res, logger);
	}
}
export const createBayi = (req: Request, res: Response) =>
	saveBayi(req, res, false);
export const updateBayi = (req: Request, res: Response) =>
	saveBayi(req, res, true);
