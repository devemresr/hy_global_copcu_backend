import { Types } from 'mongoose';
import { StockConversion } from '../models/StockConversion';
import { Order } from '../models/Order';
import { ConflictError, ValidationError } from '../errors/HttpError';
import type { StockConversionInput } from '../schemas/stockConversion.schema';
import { loadStock, nextStockEventTime, withStockWrite } from './stock.service';
export function recordStockConversion(
	input: StockConversionInput,
	actor: { adminId: string; adminUsername: string },
) {
	return withStockWrite(async () => {
		const existing = await StockConversion.findById(input.requestId).lean();
		if (existing) {
			const previous = (
				existing.lines?.length ? existing.lines : [existing]
			).map((line) => ({
				sourceLotId: line.sourceLotId,
				fromUnit: line.fromUnit,
				fromQuantity: line.fromQuantity,
				toUnit: line.toUnit,
				toQuantity: line.toQuantity,
			}));
			if (
				JSON.stringify(previous) !== JSON.stringify(input.lines) ||
				existing.note !== input.note
			)
				throw new ConflictError(
					'Bu işlem kimliği farklı bir dönüşümde kullanıldı.',
				);
			return { conversion: existing, isNew: false };
		}
		const state = await loadStock();
		const lines = input.lines.map((line, index) => {
			const source = state.lots.find((lot) => lot.lotId === line.sourceLotId);
			if (!source || source.remaining <= 0)
				throw new ValidationError(
					index +
						1 +
						'. satır: Kaynak stok bulunamadı veya tükendi. Stok listesini yenileyin.',
				);
			if (source.quantityUnit !== (line.fromUnit === 'piece' ? 'piece' : 'kg'))
				throw new ValidationError('Kaynak stoğa uygun birim seçin.');
			const sourceQuantity = Number(
				(line.fromQuantity / (line.fromUnit === 'g' ? 1000 : 1)).toFixed(6),
			);
			const targetQuantity = Number(
				(line.toQuantity / (line.toUnit === 'g' ? 1000 : 1)).toFixed(6),
			);
			if (
				sourceQuantity <= 0 ||
				targetQuantity <= 0 ||
				sourceQuantity > source.remaining + 0.0000001
			)
				throw new ValidationError(
					index +
						1 +
						'. satır: Dönüştürülecek miktar kaynak stoktan fazla olamaz.',
				);
			const cost =
				sourceQuantity === source.remaining
					? source.remainingValue
					: Number(
							(
								(source.remainingValue * sourceQuantity) /
								source.remaining
							).toFixed(6),
						);
			return {
				...line,
				sourceQuantity,
				targetQuantity,
				cost,
				orderId: source.orderId,
				bayiId: source.bayiId,
				bayiName: source.currentBayiName || source.bayiName,
				type: source.type,
				memoryGb: source.memoryGb,
			};
		});
		const links = new Map(
			lines
				.filter((line) => line.bayiId)
				.map((line) => [line.orderId, line.bayiId]),
		);
		if (links.size)
			await Order.bulkWrite(
				[...links].map(([orderId, bayiId]) => ({
					updateOne: {
						filter: { _id: new Types.ObjectId(orderId), bayiId: null },
						update: { $set: { bayiId: new Types.ObjectId(bayiId) } },
						timestamps: false,
					},
				})),
			);
		const conversion = await StockConversion.create({
			_id: input.requestId,
			...input,
			lines,
			createdAt: nextStockEventTime(state),
			createdBy: actor.adminId,
			adminUsername: actor.adminUsername,
		});
		return { conversion: conversion.toObject(), isNew: true };
	});
}
