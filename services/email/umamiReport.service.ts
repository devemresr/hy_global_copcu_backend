import { z } from '../../util/zodTurkish';
import env from '../../config/env';
import { ValidationError } from '../../errors/HttpError';
import { reportPeriodRange } from '../../util/reportScheduleTime';
import type { ReportScheduleInput } from '../../schemas/reportSchedule.schema';
import type { OperationReceipt } from './operationReceipt.service';

export function umamiConfigured() {
	return !!(
		env.UMAMI_BASE_URL &&
		env.UMAMI_WEBSITE_ID &&
		(env.UMAMI_API_TOKEN || (env.UMAMI_USERNAME && env.UMAMI_PASSWORD))
	);
}
const metricSchema = z.array(
	z
		.object({ x: z.union([z.string(), z.number(), z.null()]), y: z.number() })
		.passthrough(),
);
const statsSchema = z
	.object({
		pageviews: z.object({ value: z.number() }),
		visitors: z.object({ value: z.number() }),
		visits: z.object({ value: z.number() }),
		bounces: z.object({ value: z.number() }),
		totaltime: z.object({ value: z.number() }),
	})
	.passthrough();
const labels: Record<string, string> = {
	url: 'Sayfalar',
	referrer: 'Trafik kaynakları',
	browser: 'Tarayıcılar',
	os: 'İşletim sistemleri',
	device: 'Cihazlar',
	country: 'Ülkeler',
	region: 'Bölgeler',
	city: 'Şehirler',
	language: 'Diller',
	event: 'Özel olaylar',
};
export async function umamiReportReceipt(
	schedule: ReportScheduleInput & { adminId: string; adminName: string },
	runId: string,
	now = new Date(),
): Promise<OperationReceipt> {
	if (!umamiConfigured())
		throw new ValidationError(
			'Umami bağlantısını sunucu ortam değişkenlerinde yapılandırın: UMAMI_BASE_URL, UMAMI_WEBSITE_ID ve API anahtarı veya kullanıcı adı / parola.',
		);
	const base = z.string().url().parse(env.UMAMI_BASE_URL).replace(/\/$/, '');
	const site = z.string().uuid().parse(env.UMAMI_WEBSITE_ID);
	const deadline = Date.now() + 120_000;
	async function request(
		path: string,
		token?: string,
		body?: object,
		optional = false,
	): Promise<unknown> {
		const timeout = Math.min(15_000, deadline - Date.now());
		if (timeout <= 0)
			throw new ValidationError(
				'Umami dışa aktarımı zaman sınırını aştı. Daha kısa bir rapor dönemi seçin.',
			);
		const response = await fetch(base + '/api/' + path, {
			method: body ? 'POST' : 'GET',
			headers: {
				Accept: 'application/json',
				...(token ? { Authorization: 'Bearer ' + token } : {}),
				...(body ? { 'Content-Type': 'application/json' } : {}),
			},
			...(body ? { body: JSON.stringify(body) } : {}),
			signal: AbortSignal.timeout(timeout),
			redirect: 'error',
		});
		if (optional && [400, 404, 405].includes(response.status))
			return { unavailable: true, status: response.status };
		if (!response.ok)
			throw new ValidationError(
				'Umami API isteği başarısız (HTTP ' +
					response.status +
					'). Bağlantıyı ve okuma yetkilerini kontrol edin.',
			);
		return response.json();
	}
	const token =
		env.UMAMI_API_TOKEN ||
		z.object({ token: z.string().min(1) }).parse(
			await request('auth/login', undefined, {
				username: env.UMAMI_USERNAME,
				password: env.UMAMI_PASSWORD,
			}),
		).token;
	const range = reportPeriodRange(schedule.relativePeriod, now);
	const startAt = range.from
		? new Date(range.from + 'T00:00:00+03:00').getTime()
		: 0;
	const endAt = Math.min(
		now.getTime(),
		range.until
			? new Date(range.until + 'T23:59:59.999+03:00').getTime()
			: now.getTime(),
	);
	const query = new URLSearchParams({
		startAt: String(startAt),
		endAt: String(endAt),
		timezone: 'Europe/Istanbul',
	});
	const endpoint = 'websites/' + site + '/';
	const stats = statsSchema.parse(
		await request(endpoint + 'stats?' + query, token),
	);
	const metrics: Record<string, z.infer<typeof metricSchema>> = {};
	for (const type of Object.keys(labels)) {
		const all: z.infer<typeof metricSchema> = [];
		let previous = '';
		for (let offset = 0; ; offset += 1000) {
			const params = new URLSearchParams(query);
			params.set(
				'type',
				env.UMAMI_API_VERSION === '3' && type === 'url' ? 'path' : type,
			);
			params.set('limit', '1000');
			params.set('offset', String(offset));
			const page = metricSchema.parse(
				await request(endpoint + 'metrics?' + params, token),
			);
			const signature = JSON.stringify(page);
			if (page.length && signature === previous)
				throw new ValidationError(
					'Umami sürümü sayfalı metrik dışa aktarımını desteklemiyor. UMAMI_API_VERSION ayarını kontrol edin.',
				);
			previous = signature;
			all.push(...page);
			if (page.length < 1000) break;
		}
		metrics[type] = all;
	}
	const seriesQuery = new URLSearchParams(query);
	seriesQuery.set('unit', 'day');
	const pageviews = await request(endpoint + 'pageviews?' + seriesQuery, token);
	const events = await request(
		endpoint + 'events/series?' + seriesQuery,
		token,
	);
	const propertyData: Record<string, unknown> = {};
	for (const name of [
		'event-data/events',
		'event-data/fields',
		'session-data/properties',
	])
		propertyData[name] = await request(
			endpoint + name + '?' + query,
			token,
			undefined,
			true,
		);
	const payload = {
		websiteId: site,
		generatedAt: now.toISOString(),
		period: schedule.relativePeriod,
		range: { startAt, endAt, timezone: 'Europe/Istanbul' },
		stats,
		metrics,
		pageviews,
		events,
		propertyData,
	};
	const json = Buffer.from(JSON.stringify(payload, null, 2));
	if (json.length > 8_000_000)
		throw new ValidationError(
			'Umami verileri e-posta eki için fazla büyük. Daha kısa bir rapor dönemi seçin.',
		);
	const unavailable = Object.entries(propertyData)
		.filter(
			([, value]) =>
				typeof value === 'object' && value !== null && 'unavailable' in value,
		)
		.map(([name]) => name);
	return {
		kind: 'report',
		recordId: runId,
		title: schedule.name,
		adminId: schedule.adminId,
		adminName: schedule.adminName,
		occurredAt: now.toISOString(),
		partyLabel: 'Veri kaynağı',
		partyName: 'Umami · ' + site,
		totalLabel: 'Sayfa görüntülenmesi',
		total: stats.pageviews.value,
		totalFormat: 'number',
		notes: [
			'Rapor dönemi: ' +
				schedule.relativePeriod +
				' · ' +
				(range.from ?? 'Başlangıç sınırı yok') +
				' – ' +
				(range.until ?? 'Bugün') +
				' (İstanbul)',
			'Bu dosya analitik rapor verilerini içerir; ham Umami veritabanı yedeği değildir.',
			...(schedule.includeData
				? [
						'Tüm getirilen metrik satırları, zaman serileri ve desteklenen özellik özetleri JSON ekindedir. E-posta ve PDF, her dağılımın ilk 20 satırını gösterir.',
					]
				: []),
			...(unavailable.length
				? [
						'Bu Umami sürümünün sağlamadığı özellik uçları: ' +
							unavailable.join(', '),
					]
				: []),
		],
		tables: [
			{
				title: 'Trafik özeti',
				headers: ['Ölçüm', 'Değer'],
				rows: [
					['Sayfa görüntülenmesi', String(stats.pageviews.value)],
					['Ziyaretçi', String(stats.visitors.value)],
					['Oturum', String(stats.visits.value)],
					['Tek sayfalık ziyaret', String(stats.bounces.value)],
					['Toplam süre (saniye)', String(stats.totaltime.value)],
				],
			},
			...Object.entries(metrics).map(([type, rows]) => ({
				title: labels[type],
				headers: [labels[type], 'Sayı'],
				rows: rows
					.slice(0, 20)
					.map((row) => [String(row.x ?? 'Bilinmiyor'), String(row.y)]),
			})),
		],
		...(schedule.includeData
			? {
					extraAttachments: [
						{
							filename: 'umami-' + runId + '.json',
							contentBase64: json.toString('base64'),
							contentType: 'application/json',
						},
					],
				}
			: {}),
	};
}
