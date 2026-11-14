import { ReportSchedule } from '../../models/ReportSchedule';
import { reportScheduleSchema } from '../../schemas/reportSchedule.schema';
import { nextReportRun } from '../../util/reportScheduleTime';
import logger from '../../util/logger';
import { scheduledReportReceipt } from './scheduledReportReceipt.service';
import { queueTransactionEmail } from './transactionEmail.service';

let timer: ReturnType<typeof setInterval> | undefined;
let running: Promise<void> | undefined;
let stopped = true;
const log = logger.child({ module: 'reportScheduler' });
async function prepareDueReports() {
	for (let i = 0; i < 50 && !stopped; i++) {
		const now = new Date();
		const job = await ReportSchedule.findOneAndUpdate(
			{
				enabled: true,
				nextRunAt: { $lte: now },
				$or: [
					{ lockedAt: null },
					{ lockedAt: { $lt: new Date(now.getTime() - 300_000) } },
				],
			},
			[
				{
					$set: {
						lockedAt: now,
						pendingRunAt: { $ifNull: ['$pendingRunAt', '$nextRunAt'] },
					},
				},
			],
			{ sort: { nextRunAt: 1 }, returnDocument: 'after', updatePipeline: true },
		).lean();
		if (!job) return;
		try {
			const input = reportScheduleSchema.parse({
				name: job.name,
				source: job.source ?? 'analysis',
				includeData: job.includeData,
				analysisUrl: job.analysisUrl,
				enabled: job.enabled,
				includePdf: job.includePdf,
				frequency: job.frequency,
				time: job.time,
				weekday: job.weekday,
				monthDay: job.monthDay,
				relativePeriod: job.relativePeriod,
				recipients: job.recipients,
			});
			const receipt = await scheduledReportReceipt(
				{
					...input,
					adminId: String(job.updatedBy ?? job.createdBy),
					adminName: job.adminName,
				},
				`${job._id}-${(job.pendingRunAt ?? job.nextRunAt).toISOString()}`,
				now,
			);
			if (
				!(await ReportSchedule.exists({
					_id: job._id,
					enabled: true,
					lockedAt: now,
				}))
			)
				continue;
			if (
				!(await queueTransactionEmail(receipt, {
					includePdf: job.includePdf,
					recipients: job.recipients,
					scheduleId: String(job._id),
				}))
			)
				throw new Error('Could not queue report');
			await ReportSchedule.updateOne(
				{ _id: job._id, lockedAt: now },
				{
					$set: {
						lastQueuedAt: now,
						lastError: null,
						lockedAt: null,
						pendingRunAt: null,
						nextRunAt: nextReportRun(input, new Date()),
					},
				},
			);
		} catch (error) {
			log.error(
				{ err: error, scheduleId: job._id },
				'Scheduled report generation failed',
			);
			await ReportSchedule.updateOne(
				{ _id: job._id, lockedAt: now },
				{
					$set: {
						lockedAt: null,
						nextRunAt: new Date(Date.now() + 300_000),
						lastError:
							'Rapor hazırlanamadı; beş dakika sonra tekrar denenecek.',
					},
				},
			);
		}
	}
}
function tick() {
	if (running) return running;
	running = prepareDueReports()
		.catch((error) => log.error({ err: error }, 'Report scheduler failed'))
		.finally(() => {
			running = undefined;
		});
	return running;
}
export function startReportSchedules() {
	if (timer) return;
	stopped = false;
	timer = setInterval(() => void tick(), 30_000);
	timer.unref();
	void tick();
}
export async function stopReportSchedules() {
	stopped = true;
	if (timer) clearInterval(timer);
	timer = undefined;
	await running;
}
