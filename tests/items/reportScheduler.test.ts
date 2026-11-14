import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { ReportSchedule } from '../../models/ReportSchedule';
import {
	startReportSchedules,
	stopReportSchedules,
} from '../../services/email/reportSchedule.service';

const mocks = vi.hoisted(() => ({ build: vi.fn(), queue: vi.fn() }));
vi.mock('../../services/email/scheduledReportReceipt.service', () => ({
	scheduledReportReceipt: mocks.build,
}));
vi.mock('../../services/email/transactionEmail.service', () => ({
	queueTransactionEmail: mocks.queue,
	sendReceiptEmail: vi.fn(),
}));

beforeEach(() => {
	mocks.build.mockReset().mockImplementation(async (_schedule, recordId) => ({
		kind: 'report',
		recordId,
	}));
	mocks.queue.mockReset().mockResolvedValue(true);
});
afterEach(() => stopReportSchedules());

function schedule(overrides: Record<string, unknown> = {}) {
	return ReportSchedule.create({
		name: 'Haftalık rapor',
		analysisUrl:
			'http://localhost:5173/admin/analiz?preset=purchases&period=thisWeek',
		enabled: true,
		includePdf: true,
		frequency: 'daily',
		time: '09:00',
		weekday: 1,
		monthDay: 1,
		relativePeriod: 'thisWeek',
		recipients: ['admin@example.test'],
		createdBy: new Types.ObjectId(),
		adminName: 'admin',
		nextRunAt: new Date(Date.now() - 60_000),
		...overrides,
	});
}
async function tick() {
	startReportSchedules();
	// Stop the timer and wait for the already-started claim to finish.
	await stopReportSchedules();
}

it('claims a due schedule using the real MongoDB pipeline and queues its original run ID', async () => {
	const job = await schedule();
	await tick();
	expect(mocks.build).toHaveBeenCalledOnce();
	expect(mocks.build.mock.calls[0][1]).toBe(
		`${job._id}-${job.nextRunAt.toISOString()}`,
	);
	expect(mocks.queue).toHaveBeenCalledWith(
		expect.objectContaining({
			recordId: `${job._id}-${job.nextRunAt.toISOString()}`,
		}),
		{
			includePdf: true,
			recipients: ['admin@example.test'],
			scheduleId: String(job._id),
		},
	);
	const saved = await ReportSchedule.findById(job._id).lean();
	expect(saved?.lastQueuedAt).toBeInstanceOf(Date);
	expect(saved?.lockedAt).toBeNull();
	expect(saved?.pendingRunAt).toBeNull();
	expect(saved!.nextRunAt.getTime()).toBeGreaterThan(Date.now());
});

it('preserves the original run ID when queueing fails and the schedule is retried', async () => {
	const job = await schedule();
	mocks.queue.mockResolvedValueOnce(false);
	await tick();
	const failed = await ReportSchedule.findById(job._id).lean();
	expect(failed?.pendingRunAt?.toISOString()).toBe(job.nextRunAt.toISOString());
	expect(failed?.lastQueuedAt).toBeNull();
	expect(failed?.lastError).toBeTruthy();
	await ReportSchedule.updateOne(
		{ _id: job._id },
		{ $set: { nextRunAt: new Date(Date.now() - 1000) } },
	);
	await tick();
	expect(mocks.queue).toHaveBeenCalledTimes(2);
	expect(mocks.queue.mock.calls.map((call) => call[0].recordId)).toEqual([
		`${job._id}-${job.nextRunAt.toISOString()}`,
		`${job._id}-${job.nextRunAt.toISOString()}`,
	]);
	expect(
		(await ReportSchedule.findById(job._id).lean())?.pendingRunAt,
	).toBeNull();
});

it('does not claim paused, future or recently locked schedules', async () => {
	await schedule({ enabled: false });
	await schedule({ nextRunAt: new Date(Date.now() + 60_000) });
	await schedule({ lockedAt: new Date() });
	await tick();
	expect(mocks.build).not.toHaveBeenCalled();
	expect(mocks.queue).not.toHaveBeenCalled();
});
