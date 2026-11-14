import { stockConversionLines } from '../services/stockConversionLines';
import type { Request, Response } from 'express';
import { User } from '../models/User';
import { LOG_ACTIONS, LOG_ENTITY_TYPES } from '../models/LogEvent';
import { loadStock } from '../services/stock.service';
import { recordStockConversion } from '../services/stockConversion.service';
import { stockConversionSchema } from '../schemas/stockConversion.schema';
import { recordLogEvent } from '../services/logEvents/recordLogEvent.service';
import {
	conversionReceipt,
	formatPurchaseProduct,
	formatPurchaseQuantity,
} from '../services/email/operationReceipt.service';
import { queueTransactionEmail } from '../services/email/transactionEmail.service';
import { requireUserId } from './auth.helper';
import { UnauthorizedError } from '../errors/HttpError';
import { handleHttpError } from '../errors/handleHttpError';
import logger from '../util/logger';
export async function getStockConversions(_req: Request, res: Response) {
	try {
		const state = await loadStock();
		res.json({
			sources: state.lots.filter((lot) => lot.remaining > 0),
			conversions: [...state.conversions]
				.reverse()
				.slice(0, 50)
				.map((item) => ({ ...item, lines: stockConversionLines(item) })),
		});
	} catch (error) {
		handleHttpError(error, res, logger);
	}
}
export async function postStockConversion(req: Request, res: Response) {
	try {
		const adminId = requireUserId(req),
			admin = await User.findById(adminId).select('username').lean();
		if (!admin) throw new UnauthorizedError();
		const actor = { adminId, adminUsername: admin.username };
		const { conversion, isNew } = await recordStockConversion(
			stockConversionSchema.parse(req.body),
			actor,
		);
		const lines = stockConversionLines(conversion);
		if (isNew) {
			await recordLogEvent({
				...actor,
				action: LOG_ACTIONS.STOCK_CONVERSION_CREATE,
				entityType: LOG_ENTITY_TYPES.STOCK_CONVERSION,
				entityId: null,
				entityKey: 'Stok birimi dönüşümü · ' + lines.length + ' satır',
				bayis: lines.map((line) => ({
					bayiId: line.bayiId || null,
					bayiName: line.bayiName,
				})),
				fields: [
					{
						field: 'Dönüşüm kimliği',
						previousValue: null,
						newValue: String(conversion._id),
					},
					...lines.map((line, index) => ({
						field:
							index +
							1 +
							'. satır · ' +
							formatPurchaseProduct(line) +
							' · Bayi: ' +
							line.bayiName,
						previousValue: formatPurchaseQuantity(
							line.fromQuantity,
							line.fromUnit,
						),
						newValue:
							formatPurchaseQuantity(line.toQuantity, line.toUnit) +
							' · Kaynak alış: ' +
							line.orderId +
							' · Maliyet: ' +
							line.cost,
					})),
					...(conversion.note
						? [
								{
									field: 'Açıklama',
									previousValue: null,
									newValue: conversion.note,
								},
							]
						: []),
				],
			});
			await queueTransactionEmail(conversionReceipt(conversion, actor));
		}
		res.status(isNew ? 201 : 200).json({ conversion });
	} catch (error) {
		handleHttpError(error, res, logger);
	}
}
