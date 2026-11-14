import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { umamiReportReceipt } from '../../services/email/umamiReport.service';
import { reportScheduleSchema } from '../../schemas/reportSchedule.schema';
const state = vi.hoisted(() => ({ version: '2' as '2' | '3' }));
vi.mock('../../config/env', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../config/env')>();
	return {
		...actual,
		default: {
			...actual.default,
			UMAMI_BASE_URL: 'https://umami.example.test',
			UMAMI_WEBSITE_ID: '11111111-1111-4111-8111-111111111111',
			UMAMI_API_TOKEN: 'mock-token',
			get UMAMI_API_VERSION() {
				return state.version;
			},
		},
	};
});
const stats = {
	pageviews: 0,
	visitors: 2,
	visits: 3,
	bounces: 1,
	totaltime: 42,
};
const input = () => ({
	...reportScheduleSchema.parse({
		source: 'umami',
		name: 'Umami',
		enabled: false,
		includePdf: false,
		includeData: true,
		frequency: 'daily',
		time: '09:00',
		weekday: 1,
		monthDay: 1,
		relativePeriod: 'last7Days',
	}),
	adminId: 'admin',
	adminName: 'Yönetici',
});
const json = (value: unknown, status = 200) =>
	new Response(JSON.stringify(value), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
let fetchMock: ReturnType<typeof vi.fn>;
function respond(url: URL) {
	if (url.pathname.endsWith('/stats')) return json(stats);
	if (url.pathname.endsWith('/pageviews'))
		return json({ pageviews: [], sessions: [] });
	return json([]);
}
beforeEach(() => {
	state.version = '2';
	fetchMock = vi.fn(async (value: string) => respond(new URL(value)));
	vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());
it('retries the renamed page metric and keeps the successful alias on subsequent pages', async () => {
	fetchMock.mockImplementation(async (value: string) => {
		const url = new URL(value);
		if (url.pathname.endsWith('/metrics')) {
			if (url.searchParams.get('type') === 'url')
				return json({ error: 'unsupported metric' }, 400);
			if (url.searchParams.get('type') === 'path')
				return json(
					url.searchParams.get('offset') === '0'
						? Array.from({ length: 1000 }, (_, index) => ({
								x: '/page-' + index,
								y: 1,
							}))
						: [{ x: '/last', y: 1 }],
				);
		}
		return respond(url);
	});
	const receipt = await umamiReportReceipt(input(), 'run');
	const metrics = fetchMock.mock.calls
		.map(([value]) => new URL(value))
		.filter((url) => url.pathname.endsWith('/metrics'));
	expect(metrics[0].searchParams.get('type')).toBe('url');
	expect(metrics[1].searchParams.get('type')).toBe('path');
	expect(metrics[2].searchParams.get('type')).toBe('path');
	expect(metrics[2].searchParams.get('offset')).toBe('1000');
	const payload = JSON.parse(
		Buffer.from(
			receipt.extraAttachments![0].contentBase64,
			'base64',
		).toString(),
	);
	expect(payload.metrics.url).toHaveLength(1001);
	expect(payload.stats.pageviews.value).toBe(0);
});
it('supports the reverse alias for an older instance with a newer configured version', async () => {
	state.version = '3';
	fetchMock.mockImplementation(async (value: string) => {
		const url = new URL(value);
		return url.pathname.endsWith('/metrics') &&
			url.searchParams.get('type') === 'path'
			? json({}, 400)
			: respond(url);
	});
	await umamiReportReceipt(input(), 'run');
	const names = fetchMock.mock.calls
		.map(([value]) => new URL(value))
		.filter((url) => url.pathname.endsWith('/metrics'))
		.map((url) => url.searchParams.get('type'));
	expect(names.slice(0, 2)).toEqual(['path', 'url']);
});
it('reports the failing endpoint and metric without hiding unrelated HTTP errors', async () => {
	fetchMock.mockImplementation(async (value: string) => {
		const url = new URL(value);
		return url.pathname.endsWith('/metrics') &&
			url.searchParams.get('type') === 'browser'
			? json({ error: 'private provider response' }, 400)
			: respond(url);
	});
	await expect(umamiReportReceipt(input(), 'run')).rejects.toMatchObject({
		message: 'Umami API request failed',
		statusCode: 502,
		details: {
			upstreamStatus: 400,
			metric: 'browser',
			endpoint: 'websites/11111111-1111-4111-8111-111111111111/metrics',
		},
	});
});
