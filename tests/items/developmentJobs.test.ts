import { beforeEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../../app';
import { User } from '../../models/User';
import { ReportSchedule } from '../../models/ReportSchedule';
import { InventorySnapshotSchedule } from '../../models/InventorySnapshotSchedule';
import { loginAndGetTokens, TEST_USER } from '../helpers';
const mocks = vi.hoisted(() => ({
	mode: 'development',
	build: vi.fn(),
	send: vi.fn(),
	write: vi.fn(),
}));
vi.mock('../../config/env', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../config/env')>();
	return {
		...actual,
		default: {
			...actual.default,
			get NODE_ENV() {
				return mocks.mode;
			},
		},
	};
});
vi.mock('../../services/email/scheduledReportReceipt.service', () => ({
	scheduledReportReceipt: mocks.build,
}));
vi.mock('../../services/email/transactionEmail.service', () => ({
	sendReceiptEmail: mocks.send,
	queueTransactionEmail: vi.fn(),
}));
vi.mock('../../services/snapshot/inventorySnapshot.service', () => ({
	inventorySnapshotPath: () => '/mock/items-snapshot.json',
	writeInventorySnapshot: mocks.write,
}));
const receipt = {
	kind: 'report',
	recordId: 'preview',
	title: 'Umami raporu',
	adminId: 'admin',
	adminName: 'Yönetici',
	occurredAt: '2026-11-15T10:00:00.000Z',
	partyLabel: 'Veri kaynağı',
	partyName: 'Umami',
	tables: [{ headers: ['Ölçüm', 'Değer'], rows: [['Ziyaretçi', '42']] }],
	totalLabel: 'Görüntülenme',
	total: 100,
	totalFormat: 'number',
};
beforeEach(() => {
	mocks.mode = 'development';
	mocks.build.mockReset().mockResolvedValue(receipt);
	mocks.send.mockReset().mockResolvedValue(undefined);
	mocks.write
		.mockReset()
		.mockResolvedValue({ exportedAt: new Date(), itemCount: 7 });
});
async function headAdmin() {
	await User.updateOne(
		{ email: TEST_USER.email },
		{ $set: { role: 'head_admin' } },
	);
	return (await loginAndGetTokens()).accessToken;
}
async function schedule() {
	return ReportSchedule.create({
		name: 'Umami raporu',
		source: 'umami',
		enabled: false,
		includePdf: true,
		includeData: false,
		frequency: 'weekly',
		time: '09:00',
		weekday: 1,
		monthDay: 1,
		relativePeriod: 'lastWeek',
		recipients: ['admin@example.test'],
		createdBy: (await User.findOne({ email: TEST_USER.email }))!._id,
		adminName: 'admin',
		nextRunAt: new Date(Date.now() + 86_400_000),
	});
}
it('requires authentication and a head admin for preview and manual snapshot refresh', async () => {
	const path = '/admins/report-schedules/000000000000000000000001/preview';
	for (const url of [path, '/admins/inventory-snapshot/refresh-now'])
		await request(app).post(url).expect(401);
	const { accessToken } = await loginAndGetTokens();
	for (const url of [path, '/admins/inventory-snapshot/refresh-now'])
		await request(app)
			.post(url)
			.set('Authorization', 'Bearer ' + accessToken)
			.expect(403);
	expect(mocks.build).not.toHaveBeenCalled();
	expect(mocks.write).not.toHaveBeenCalled();
});
it('previews a paused Umami task without sending email or moving its next run', async () => {
	const token = await headAdmin(),
		job = await schedule();
	const response = await request(app)
		.post('/admins/report-schedules/' + job._id + '/preview')
		.set('Authorization', 'Bearer ' + token)
		.expect(200);
	expect(response.body.html).toContain('Ziyaretçi');
	expect(response.body.html).toContain('42');
	expect(response.body.subject).toContain('Umami raporu');
	expect(response.body.attachments).toEqual(['report-preview.pdf']);
	expect(mocks.build).toHaveBeenCalledWith(
		expect.objectContaining({
			source: 'umami',
			enabled: false,
			relativePeriod: 'lastWeek',
		}),
		expect.any(String),
	);
	expect(mocks.send).not.toHaveBeenCalled();
	expect((await ReportSchedule.findById(job._id))!.nextRunAt).toEqual(
		job.nextRunAt,
	);
});
it('sends a Umami task separately through the existing email action', async () => {
	const token = await headAdmin(),
		job = await schedule();
	await request(app)
		.post('/admins/report-schedules/' + job._id + '/send-now')
		.set('Authorization', 'Bearer ' + token)
		.expect(200);
	expect(mocks.send).toHaveBeenCalledWith(receipt, {
		recipients: ['admin@example.test'],
		includePdf: true,
	});
});
it('refreshes immediately despite a future run, keeping the configured interval', async () => {
	const token = await headAdmin();
	await InventorySnapshotSchedule.create({
		_id: 'inventory',
		intervalMinutes: 90,
		nextRunAt: new Date(Date.now() + 86_400_000),
	});
	const response = await request(app)
		.post('/admins/inventory-snapshot/refresh-now')
		.set('Authorization', 'Bearer ' + token)
		.expect(200);
	expect(mocks.write).toHaveBeenCalledOnce();
	expect(response.body.schedule.intervalMinutes).toBe(90);
	expect(response.body.schedule.lastItemCount).toBe(7);
	expect(new Date(response.body.schedule.nextRunAt).getTime()).toBeGreaterThan(
		Date.now() + 89 * 60_000,
	);
});
it('does not overlap a snapshot already claimed by the scheduler', async () => {
	const token = await headAdmin();
	await InventorySnapshotSchedule.create({
		_id: 'inventory',
		intervalMinutes: 60,
		nextRunAt: new Date(),
		lockedAt: new Date(),
		claimId: 'active',
	});
	await request(app)
		.post('/admins/inventory-snapshot/refresh-now')
		.set('Authorization', 'Bearer ' + token)
		.expect(409);
	expect(mocks.write).not.toHaveBeenCalled();
});
it('reports a failed refresh without discarding last-success metadata', async () => {
	const token = await headAdmin(),
		previous = new Date('2026-11-14T12:00:00.000Z');
	await InventorySnapshotSchedule.create({
		_id: 'inventory',
		intervalMinutes: 60,
		nextRunAt: new Date(),
		lastExportedAt: previous,
		lastItemCount: 5,
	});
	mocks.write.mockRejectedValue(new Error('Write failed'));
	await request(app)
		.post('/admins/inventory-snapshot/refresh-now')
		.set('Authorization', 'Bearer ' + token)
		.expect(500);
	const job = await InventorySnapshotSchedule.findById('inventory');
	expect(job!.lastExportedAt).toEqual(previous);
	expect(job!.lastItemCount).toBe(5);
	expect(job!.lastError).toContain('korunuyor');
});
it('blocks preview, immediate email and snapshot refresh outside development', async () => {
	const token = await headAdmin(),
		job = await schedule();
	mocks.mode = 'production';
	for (const url of [
		'/admins/report-schedules/' + job._id + '/preview',
		'/admins/report-schedules/' + job._id + '/send-now',
		'/admins/inventory-snapshot/refresh-now',
	])
		await request(app)
			.post(url)
			.set('Authorization', 'Bearer ' + token)
			.expect(404);
	expect(mocks.build).not.toHaveBeenCalled();
	expect(mocks.send).not.toHaveBeenCalled();
	expect(mocks.write).not.toHaveBeenCalled();
});
