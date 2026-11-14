import { createHash } from 'node:crypto';
import { z } from 'zod';
import pdfMake from 'pdfmake/build/pdfmake';
import fonts from 'pdfmake/build/vfs_fonts';
import env from '../../config/env';
import { ReportSchedule } from '../../models/ReportSchedule';
import { TransactionEmail } from '../../models/TransactionEmail';
import logger from '../../util/logger';
import { ValidationError } from '../../errors/HttpError';
import {
	operationDocument,
	operationEmail,
	receiptMetadata,
	type OperationReceipt,
} from './operationReceipt.service';
import { sendEmail } from './emailSender.service';
import { automaticEmailEnabled } from './emailPreferences.service';
import {
	purchaseReportDocument,
	stockSaleReportDocument,
} from '../../assets/reports/analysisDocuments.generated.mjs';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';

pdfMake.addVirtualFileSystem(fonts);
const log = logger.child({ module: 'transactionEmail' });
let timer: ReturnType<typeof setInterval> | undefined;
let draining: Promise<void> | undefined;
let stopped = true;

export async function queueTransactionEmail(
	receipt: OperationReceipt,
	options: {
		recipients?: string[];
		includePdf?: boolean;
		scheduleId?: string;
	} = {},
): Promise<boolean> {
	try {
		if (!(await automaticEmailEnabled(receipt.kind))) return true;
		// A retried save uses the same event key and never creates another email.
		await TransactionEmail.updateOne(
			{ _id: receipt.kind + ':' + receipt.recordId },
			{
				$setOnInsert: {
					receipt,
					...options,
					status: 'pending',
					attempts: 0,
					nextAttemptAt: new Date(),
				},
			},
			{ upsert: true },
		);
		if (!stopped) void flushQueue();
		return true;
	} catch (error) {
		log.error(
			{ err: error, kind: receipt.kind, recordId: receipt.recordId },
			'Could not queue transaction email; saved operation is unchanged',
		);
		return false;
	}
}
function recipients(): string[] {
	return env.TRANSACTION_EMAIL_TO.split(/[;,]/)
		.map((value) => value.trim())
		.filter(Boolean);
}
export async function sendReceiptEmail(
	receipt: OperationReceipt,
	options: { recipients?: string[]; includePdf?: boolean } = {},
	messageId?: string,
) {
	const to = options.recipients?.length ? options.recipients : recipients();
	if (!to.length)
		throw new ValidationError(
			'Raporun alıcılarını veya varsayılan e-posta alıcılarını ayarlayın.',
		);
	if (to.some((value) => !z.string().email().safeParse(value).success))
		throw new ValidationError('Geçerli rapor alıcıları ayarlayın.');
	let document: TDocumentDefinitions;
	if (receipt.analysisPdf) {
		const report = receipt.analysisPdf;
		document =
			report.kind === 'purchase'
				? purchaseReportDocument(report.data, report.filters, [])
				: stockSaleReportDocument(report.data, report.filters);
		const content = Array.isArray(document.content)
			? document.content
			: [document.content];
		document.content = [
			{ text: receipt.title, fontSize: 13, bold: true, margin: [0, 0, 0, 6] },
			...receiptMetadata(receipt).map((text) => ({
				text,
				fontSize: 9,
				margin: [0, 0, 0, 5],
			})),
			...content,
		] as Content[];
	} else document = operationDocument(receipt);
	const pdf =
		options.includePdf === false
			? null
			: Buffer.from(await pdfMake.createPdf(document).getBuffer());
	const email = operationEmail(receipt, { includePdf: !!pdf });
	await sendEmail({
		to,
		...email,
		...(messageId ? { messageId } : {}),
		attachments: [
			...(pdf
				? [
						{
							filename: receipt.kind + '-' + receipt.recordId + '.pdf',
							content: pdf,
							contentType: 'application/pdf',
							contentDisposition: 'attachment' as const,
						},
					]
				: []),
			...(receipt.extraAttachments ?? []).map((file) => ({
				filename: file.filename,
				content: Buffer.from(file.contentBase64, 'base64'),
				contentType: file.contentType,
				contentDisposition: 'attachment' as const,
			})),
		],
	});
}
async function deliverPending(): Promise<void> {
	const defaultRecipients = recipients();
	if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD || !env.SMTP_FROM)
		return;
	for (let count = 0; count < 10 && !stopped; count++) {
		const now = new Date();
		const job = await TransactionEmail.findOneAndUpdate(
			{
				...(defaultRecipients.length
					? {}
					: { 'recipients.0': { $exists: true } }),
				$or: [
					{ status: 'pending', nextAttemptAt: { $lte: now } },
					{
						status: 'sending',
						lockedAt: { $lt: new Date(now.getTime() - 120_000) },
					},
				],
			},
			{ $set: { status: 'sending', lockedAt: now }, $inc: { attempts: 1 } },
			{ returnDocument: 'after', sort: { createdAt: 1 } },
		).lean();
		if (!job) return;
		try {
			if (
				!(await automaticEmailEnabled((job.receipt as OperationReceipt).kind))
			) {
				await TransactionEmail.updateOne(
					{ _id: job._id },
					{ $set: { status: 'cancelled', lockedAt: null } },
				);
				continue;
			}
			if (
				job.scheduleId &&
				!(await ReportSchedule.exists({ _id: job.scheduleId, enabled: true }))
			) {
				await TransactionEmail.deleteOne({ _id: job._id });
				continue;
			}
			const receipt = job.receipt as OperationReceipt;
			const id = createHash('sha256').update(String(job._id)).digest('hex');
			await sendReceiptEmail(
				receipt,
				{ recipients: job.recipients ?? undefined, includePdf: job.includePdf },
				`<${id}@hyglobalcopcu.local>`,
			);
			await TransactionEmail.updateOne(
				{ _id: job._id },
				{ $set: { status: 'sent', sentAt: new Date(), lockedAt: null } },
			);
			log.info(
				{ eventId: job._id },
				'Transaction email accepted by SMTP server',
			);
		} catch {
			await TransactionEmail.updateOne(
				{ _id: job._id },
				{
					$set: {
						status: 'pending',
						lockedAt: null,
						nextAttemptAt: new Date(
							Date.now() +
								Math.min(3_600_000, 30_000 * 2 ** Math.min(job.attempts, 7)),
						),
					},
				},
			);
			log.warn(
				{ eventId: job._id, attempts: job.attempts },
				'Transaction email failed; queued for retry',
			);
		}
	}
}
async function flushQueue(): Promise<void> {
	if (draining) return draining;
	draining = deliverPending()
		.catch((error) =>
			log.error({ err: error }, 'Email queue processing failed'),
		)
		.finally(() => {
			draining = undefined;
		});
	return draining;
}
export function startTransactionEmails() {
	if (timer) return;
	stopped = false;
	timer = setInterval(() => void flushQueue(), 30_000);
	timer.unref();
	void flushQueue();
}
export async function stopTransactionEmails() {
	stopped = true;
	if (timer) clearInterval(timer);
	timer = undefined;
	await draining;
}
