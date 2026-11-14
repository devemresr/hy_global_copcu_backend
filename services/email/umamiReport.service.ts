import { z } from '../../util/zodTurkish';
import env from '../../config/env';
import { HttpError, ValidationError } from '../../errors/HttpError';
import {
	reportPeriodRange,
	reportPeriodLabel,
} from '../../util/reportScheduleTime';
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
// Umami versions return either a count or a comparison object. Normalize both
// to the comparison shape consumed by the report, preserving real zero values.
const statisticSchema = z.union([
	z
		.number()
		.finite()
		.nonnegative()
		.transform((value) => ({ value })),
	z.object({ value: z.number().finite().nonnegative() }).passthrough(),
]);
const statsSchema = z
	.object({
		pageviews: statisticSchema,
		visitors: statisticSchema,
		visits: statisticSchema,
		bounces: statisticSchema,
		totaltime: statisticSchema,
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
const eventLabel = (name: string) =>
	name === 'whatsapp-click' ? 'WhatsApp tıklaması' : name;
const propertyLabel = (name: string) => (name === 'location' ? 'Kaynak' : name);
const propertyValueLabel = (property: string, value: string) =>
	property === 'location'
		? ((
				{
					header: 'Üst menü',
					footer: 'Alt bölüm',
					'promotion-popup': 'Tanıtım penceresi',
					pricing: 'Fiyatlandırma',
					'inventory-page': 'Ürün listesi',
				} as Record<string, string>
			)[value] ?? value)
		: value;
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
		if (!response.ok) {
			const [endpoint, search] = path.split('?');
			const metric = new URLSearchParams(search).get('type');
			throw new HttpError(
				'Umami API request failed',
				502,
				`Umami isteği başarısız: ${endpoint}${metric ? ' · Ölçüm: ' + metric : ''} (HTTP ${response.status}). Umami API sürümünü ve bağlantı ayarlarını kontrol edin.`,
				{
					upstreamStatus: response.status,
					endpoint,
					...(metric ? { metric } : {}),
				},
			);
		}
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
	let pageMetric = env.UMAMI_API_VERSION === '3' ? 'path' : 'url';
	for (const type of Object.keys(labels)) {
		const all: z.infer<typeof metricSchema> = [];
		let previous = '';
		for (let offset = 0; ; offset += 1000) {
			const params = new URLSearchParams(query);
			params.set('type', type === 'url' ? pageMetric : type);
			params.set('limit', '1000');
			params.set('offset', String(offset));
			let raw: unknown;
			try {
				raw = await request(endpoint + 'metrics?' + params, token);
			} catch (error) {
				const details = error instanceof HttpError ? error.details : undefined;
				if (
					type !== 'url' ||
					offset !== 0 ||
					!details ||
					typeof details !== 'object' ||
					!('upstreamStatus' in details) ||
					details.upstreamStatus !== 400
				)
					throw error;
				// Renamed between Umami API versions. Retry only this known alias;
				// unrelated request failures must still stop the report.
				pageMetric = pageMetric === 'url' ? 'path' : 'url';
				params.set('type', pageMetric);
				raw = await request(endpoint + 'metrics?' + params, token);
			}
			const page = metricSchema.parse(raw);
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
	const unavailable = Object.entries(propertyData)
		.filter(
			([, value]) =>
				typeof value === 'object' && value !== null && 'unavailable' in value,
		)
		.map(([name]) => name);
	const eventTotals = [...(metrics.event ?? [])].sort(
		(a, b) => b.y - a.y || String(a.x).localeCompare(String(b.x), 'tr'),
	);
	const totalEvents = eventTotals.reduce((sum, row) => sum + row.y, 0);
	const eventSeries = z
		.array(
			z.object({
				x: z.string(),
				t: z.string(),
				y: z.number().finite().nonnegative(),
			}),
		)
		.parse(events);
	const eventFields = z
		.array(z.object({ eventName: z.string(), propertyName: z.string() }))
		.safeParse(propertyData['event-data/events']);
	const eventProperties: {
		eventName: string;
		propertyName: string;
		value: string;
		total: number;
	}[] = [];
	const missingEventProperties: string[] = [];
	if (eventFields.success)
		for (const field of new Map(
			eventFields.data.map((field) => [
				JSON.stringify([field.eventName, field.propertyName]),
				field,
			]),
		).values()) {
			const params = new URLSearchParams(query);
			params.set('eventName', field.eventName);
			params.set('propertyName', field.propertyName);
			const values = z
				.array(
					z.object({
						value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
						total: z.number(),
					}),
				)
				.safeParse(
					await request(
						endpoint + 'event-data/values?' + params,
						token,
						undefined,
						true,
					),
				);
			if (values.success)
				eventProperties.push(
					...values.data.map((row) => ({
						...field,
						value: String(row.value ?? 'Belirtilmemiş'),
						total: row.total,
					})),
				);
			else
				missingEventProperties.push(
					eventLabel(field.eventName) +
						' · ' +
						propertyLabel(field.propertyName),
				);
		}
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
		eventProperties,
	};
	const json = Buffer.from(JSON.stringify(payload, null, 2));
	if (json.length > 8_000_000)
		throw new ValidationError(
			'Umami verileri e-posta eki için fazla büyük. Daha kısa bir rapor dönemi seçin.',
		);

	return {
		kind: 'report',
		recordId: runId,
		title: schedule.name,
		adminId: schedule.adminId,
		adminName: schedule.adminName,
		occurredAt: now.toISOString(),
		partyLabel: 'Veri kaynağı',
		partyName: 'Umami · ' + site,
		reportSource: 'umami',
		reportPeriod: reportPeriodLabel(schedule.relativePeriod, now),
		totalLabel: 'Toplam özel olay',
		total: totalEvents,
		totalFormat: 'number',
		notes: [
			...(schedule.includeData
				? [
						'Özel olay listesi ve alınabilen olay ayrıntıları tam olarak gösterilir. Diğer trafik dağılımları ilk 20 satırla özetlenir. JSON eki tüm getirilen verileri içerir.',
					]
				: []),
			...(unavailable.length
				? [
						'Bu Umami sürümünde ayrıntısı alınamayan bilgiler: ' +
							unavailable
								.map(
									(name) =>
										(
											({
												'event-data/events': 'Olay özellikleri',
												'event-data/fields': 'Özellik değerleri',
												'session-data/properties': 'Oturum özellikleri',
											}) as Record<string, string>
										)[name] ?? name,
								)
								.join(', '),
					]
				: []),
			...(missingEventProperties.length
				? [
						'Ayrıntılı dağılımı alınamayan olay özellikleri: ' +
							missingEventProperties.join(', '),
					]
				: []),
		],
		tables: [
			{
				title: 'Özel olay özeti',
				headers: ['Ölçüm', 'Değer'],
				rows: [
					['Toplam özel olay', String(totalEvents)],
					['Farklı olay türü', String(eventTotals.length)],
				],
			},
			{
				title: 'Özel olaylar',
				headers: ['Olay', 'Tekrar sayısı', 'Pay (%)'],
				rows: eventTotals.length
					? eventTotals.map((row) => [
							eventLabel(String(row.x ?? 'Bilinmiyor')),
							String(row.y),
							totalEvents
								? ((row.y / totalEvents) * 100).toLocaleString('tr-TR', {
										maximumFractionDigits: 2,
									})
								: '0',
						])
					: [['Bu dönemde özel olay kaydı yok', '0', '—']],
			},
			...(eventProperties.length
				? [
						{
							title: 'Olay özellikleri ve kaynakları',
							headers: ['Olay', 'Özellik', 'Değer', 'Tekrar sayısı'],
							rows: eventProperties
								.sort(
									(a, b) =>
										a.eventName.localeCompare(b.eventName, 'tr') ||
										a.propertyName.localeCompare(b.propertyName, 'tr') ||
										b.total - a.total,
								)
								.map((row) => [
									eventLabel(row.eventName),
									propertyLabel(row.propertyName),
									propertyValueLabel(row.propertyName, row.value),
									String(row.total),
								]),
						},
					]
				: []),
			...(eventSeries.length
				? [
						{
							title: 'Zamana göre özel olaylar',
							headers: ['Tarih (İstanbul)', 'Olay', 'Tekrar sayısı'],
							rows: eventSeries
								.sort(
									(a, b) =>
										b.t.localeCompare(a.t) || a.x.localeCompare(b.x, 'tr'),
								)
								.map((row) => [
									new Date(row.t).toLocaleDateString('tr-TR', {
										timeZone: 'Europe/Istanbul',
									}),
									eventLabel(row.x),
									String(row.y),
								]),
						},
					]
				: []),
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
			...Object.entries(metrics)
				.filter(([type]) => type !== 'event')
				.map(([type, rows]) => ({
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
