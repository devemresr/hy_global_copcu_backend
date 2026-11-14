import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { ReportSchedule } from '../models/ReportSchedule';
import { TransactionEmail } from '../models/TransactionEmail';
import { User } from '../models/User';
import { requireUserId } from './auth.helper';
import {
	parseAnalysisReportUrl,
	reportScheduleSchema,
} from '../schemas/reportSchedule.schema';
import { nextReportRun } from '../util/reportScheduleTime';
import { handleHttpError } from '../errors/handleHttpError';
import {
	NotFoundError,
	UnauthorizedError,
	ValidationError,
} from '../errors/HttpError';
import logger from '../util/logger';
import env from '../config/env';
import { randomUUID } from 'node:crypto';
import { scheduledReportReceipt } from '../services/email/scheduledReportReceipt.service';
import { sendReceiptEmail } from '../services/email/transactionEmail.service';
import { operationEmail } from '../services/email/operationReceipt.service';
import { umamiConfigured } from '../services/email/umamiReport.service';

const log = logger.child({ module: 'reportSchedules' });
function scheduleId(req: Request) {
	const id = String(req.params.id);
	if (!/^[a-f\d]{24}$/i.test(id))
		throw new ValidationError('Geçersiz zamanlama kimliği.');
	return id;
}
export async function listReportSchedules(_req: Request, res: Response) {
	try {
		res.json({
			umamiConfigured: umamiConfigured(),
			schedules: await ReportSchedule.find().sort({ createdAt: -1 }).lean(),
		});
	} catch (error) {
		handleHttpError(error, res, log);
	}
}
export async function saveReportSchedule(req: Request, res: Response) {
	try {
		const result = reportScheduleSchema.safeParse(req.body);
		if (!result.success)
			throw new ValidationError(
				result.error.issues.map((issue) => issue.message).join(' '),
			);
		const input = result.data;
		if (input.source === 'analysis') parseAnalysisReportUrl(input.analysisUrl);
		if (input.source === 'umami' && input.enabled && !umamiConfigured())
			throw new ValidationError(
				'Umami bağlantısını sunucu ortam değişkenlerinde yapılandırın.',
			);
		const adminId = requireUserId(req),
			admin = await User.findById(adminId).select('username').lean();
		if (!admin) throw new UnauthorizedError();
		const id = req.params.id
			? scheduleId(req)
			: new Types.ObjectId().toHexString();
		if (req.params.id && !(await ReportSchedule.exists({ _id: id })))
			throw new NotFoundError('Zamanlama');
		if (!req.params.id && (await ReportSchedule.countDocuments()) >= 50)
			throw new ValidationError(
				'En fazla 50 rapor zamanlaması oluşturabilirsiniz.',
			);
		const schedule = await ReportSchedule.findByIdAndUpdate(
			id,
			{
				$set: {
					...input,
					adminName: admin.username,
					updatedBy: adminId,
					nextRunAt: nextReportRun(input),
					lockedAt: null,
					pendingRunAt: null,
					lastError: null,
				},
				$setOnInsert: { createdBy: adminId },
			},
			{ upsert: !req.params.id, returnDocument: 'after', runValidators: true },
		);
		if (!input.enabled)
			await TransactionEmail.deleteMany({ scheduleId: id, status: 'pending' });
		log.info(
			{ adminId, scheduleId: id, enabled: input.enabled },
			'Report schedule saved',
		);
		res.status(req.params.id ? 200 : 201).json({ schedule });
	} catch (error) {
		handleHttpError(error, res, log);
	}
}
export async function deleteReportSchedule(req: Request, res: Response) {
	try {
		const id = scheduleId(req);
		await ReportSchedule.deleteOne({ _id: id });
		await TransactionEmail.deleteMany({ scheduleId: id, status: 'pending' });
		log.info(
			{ adminId: requireUserId(req), scheduleId: id },
			'Report schedule deleted',
		);
		res.json({ success: true });
	} catch (error) {
		handleHttpError(error, res, log);
	}
}

async function developmentReport(req: Request) {
	if (env.NODE_ENV !== 'development') throw new NotFoundError('İşlem');
	const id = scheduleId(req);
	const schedule = await ReportSchedule.findById(id).lean();
	if (!schedule) throw new NotFoundError('Zamanlama');
	const adminId = requireUserId(req),
		admin = await User.findById(adminId).select('username').lean();
	if (!admin) throw new UnauthorizedError();
	const input = reportScheduleSchema.parse({
		name: schedule.name,
		source: schedule.source ?? 'analysis',
		includeData: schedule.includeData,
		analysisUrl: schedule.analysisUrl,
		enabled: schedule.enabled,
		includePdf: schedule.includePdf,
		frequency: schedule.frequency,
		time: schedule.time,
		weekday: schedule.weekday,
		monthDay: schedule.monthDay,
		relativePeriod: schedule.relativePeriod,
		recipients: schedule.recipients,
	});
	const receipt = await scheduledReportReceipt(
		{ ...input, adminId, adminName: admin.username },
		`dev-${id}-${randomUUID()}`,
	);
	return { id, adminId, input, receipt };
}
export async function previewReportSchedule(req: Request, res: Response) {
	try {
		const { input, receipt } = await developmentReport(req);
		const email = operationEmail(receipt, { includePdf: input.includePdf });
		res.json({
			subject: email.subject,
			html: email.html,
			attachments: [
				...(input.includePdf
					? [receipt.kind + '-' + receipt.recordId + '.pdf']
					: []),
				...(receipt.extraAttachments ?? []).map((file) => file.filename),
			],
		});
	} catch (error) {
		handleHttpError(error, res, log);
	}
}
export async function sendReportScheduleNow(req: Request, res: Response) {
	try {
		const { id, adminId, input, receipt } = await developmentReport(req);
		await sendReceiptEmail(receipt, {
			recipients: input.recipients,
			includePdf: input.includePdf,
		});
		log.info(
			{ adminId, scheduleId: id },
			'Development report email accepted by SMTP server',
		);
		res.json({
			success: true,
			pdfAttached: input.includePdf,
			dataAttached: input.source === 'umami' && input.includeData,
		});
	} catch (error) {
		handleHttpError(error, res, log);
	}
}
