import { reportFilterSummary } from '../../assets/reports/analysisDocuments.generated.mjs';
import { Investor } from '../../models/Investor';
import { Bayi } from '../../models/Bayi';
import { umamiReportReceipt } from './umamiReport.service';
import { orderReportData } from '../../controllers/orders.controller';
import { stockReportData } from '../../controllers/stock.controller';
import { financeReportData } from '../../controllers/finance.controller';
import {
	parseAnalysisReportUrl,
	type ReportScheduleInput,
} from '../../schemas/reportSchedule.schema';
import { reportPeriodRange } from '../../util/reportScheduleTime';
import {
	formatPurchaseMoney as money,
	formatPurchaseProduct as product,
	formatPurchaseQuantity as quantity,
	type OperationReceipt,
} from './operationReceipt.service';

export async function scheduledReportReceipt(
	schedule: ReportScheduleInput & { adminId: string; adminName: string },
	runId: string,
	now = new Date(),
): Promise<OperationReceipt> {
	if (schedule.source === 'umami')
		return umamiReportReceipt(schedule, runId, now);
	const report = parseAnalysisReportUrl(schedule.analysisUrl);
	const query = { ...report.filters };
	if (
		!query.movementType &&
		['sales', 'stock', 'bayis'].includes(report.preset)
	)
		query.movementType =
			report.preset === 'sales' ? 'all-sales' : 'all-movements';
	if (!query.direction && ['income', 'expenses'].includes(report.preset))
		query.direction = report.preset === 'income' ? 'income' : 'expense';
	let bayiName: string | null | undefined;
	let categoryName: string | undefined;
	// Recompute the period on every run, including older saved tasks that
	// still contain the removed dateMode field in MongoDB.
	const range = reportPeriodRange(schedule.relativePeriod, now);
	query.from = range.from;
	query.until = range.until;
	const partyName = (row: object) => {
		const fields = row as Record<string, unknown>;
		return (
			([
				fields.currentBayiName,
				fields.bayiName,
				fields.currentInvestorName,
				fields.investorName,
			].find((value) => typeof value === 'string' && value) as
				| string
				| undefined) ?? '—'
		);
	};
	const base: OperationReceipt = {
		kind: 'report',
		recordId: runId,
		title: schedule.name,
		adminId: schedule.adminId,
		adminName: schedule.adminName,
		occurredAt: now.toISOString(),
		partyLabel: 'Rapor',
		partyName: {
			purchases: 'Alışlar',
			sales: 'Satışlar',
			stock: 'Tüm stok hareketleri',
			bayis: 'Bayi bazlı analiz',
			balance: 'Bakiye',
			income: 'Gelirler',
			expenses: 'Giderler',
		}[report.preset],
		tables: [],
		totalLabel: 'Toplam',
		total: 0,
	};
	if (report.preset === 'purchases') {
		const data = await orderReportData(query, true);
		bayiName = data.bayiFilterName;
		base.analysisPdf = {
			kind: 'purchase',
			data: JSON.parse(JSON.stringify(data)),
			filters: query,
		};
		base.tables = [
			{
				title: 'Alış kayıtları',
				headers: ['Tarih', 'Alış', 'Bayi', 'Toplam'],
				rows: data.timeline.map(
					(row: {
						createdAt: Date;
						_id: unknown;
						name: string;
						total: number;
					}) => [
						new Date(row.createdAt).toLocaleDateString('tr-TR', {
							timeZone: 'Europe/Istanbul',
						}),
						String(row._id),
						row.name,
						money(row.total),
					],
				),
			},
			{
				title: 'Ürün dağılımı',
				headers: ['Ürün', 'Miktar', 'Alış tutarı'],
				rows: data.byTypeAndMemory.map(
					(row: {
						type: string;
						memoryGb: number | null;
						requiresMemorySize?: boolean;
						quantity: number;
						quantityUnit: string;
						total: number;
					}) => [
						product(row),
						quantity(row.quantity, row.quantityUnit),
						money(row.total),
					],
				),
			},
		];
		base.total = data.summary.total;
		base.totalLabel = 'Alış toplamı';
	} else if (['balance', 'income', 'expenses'].includes(report.preset)) {
		const data = await financeReportData(query, true);
		categoryName = data.categories.find(
			(row) => String(row._id) === query.categoryId,
		)?.name;
		const showIncome = query.direction !== 'expense';
		const showExpenses = query.direction !== 'income';
		base.tables = [
			{
				title: 'Dönem özeti',
				headers: [
					...(showIncome ? ['Gelir'] : []),
					...(showExpenses ? ['Gider'] : []),
					'Net hareket',
					'Genel bakiye',
				],
				rows: [
					[
						...(showIncome ? [money(data.income)] : []),
						...(showExpenses ? [money(data.expenses)] : []),
						money(data.net),
						money(data.balance),
					],
				],
			},
			{
				title: 'Günlük net hareketler',
				headers: [
					'Tarih',
					...(showIncome ? ['Gelir'] : []),
					...(showExpenses ? ['Gider'] : []),
					'Net hareket',
				],
				rows: data.daily.map((day) => [
					day.date,
					...(showIncome ? [money(day.income)] : []),
					...(showExpenses ? [money(day.expenses)] : []),
					money(day.net),
				]),
			},
			{
				title: 'Hareketler',
				headers: ['Tarih', 'Ana tür', 'Alt tür', 'Bayi / yatırımcı', 'Tutar'],
				rows: data.entries.map((row) => [
					row.date,
					row.direction === 'income' ? 'Gelir' : 'Gider',
					row.subtype,
					partyName(row),
					money(row.amount),
				]),
			},
		];
		base.total = data.net;
		base.totalLabel = 'Net hareket';
	} else {
		const data = await stockReportData(query, true);
		bayiName = data.bayiFilterName;
		base.analysisPdf = {
			kind: 'stock',
			data: JSON.parse(JSON.stringify(data)),
			filters: query,
		};
		base.tables = [
			{
				title: 'Dönem özeti',
				headers: [
					'Alış toplamı',
					'Satış geliri',
					'Satılan mal maliyeti',
					'Kâr',
				],
				rows: [
					[
						money(data.reportTotals.purchaseCost),
						money(data.reportTotals.revenue),
						money(data.reportTotals.costOfGoods),
						money(data.reportTotals.profit),
					],
				],
			},
			{
				title: 'Ürün özeti',
				headers: [
					'Ürün',
					'Satılan miktar',
					'Rapor anındaki stok',
					'Ort. alış',
					'Ort. satış',
					'Kâr marjı',
				],
				rows: data.productSummary.map((row) => [
					product(row),
					quantity(row.soldQuantity, row.quantityUnit),
					quantity(row.currentQuantity, row.quantityUnit),
					row.averagePurchasePrice === null
						? '—'
						: money(row.averagePurchasePrice),
					row.averageSellingPrice === null
						? '—'
						: money(row.averageSellingPrice),
					row.margin === null
						? '—'
						: row.margin.toLocaleString('tr-TR', { maximumFractionDigits: 2 }) +
							'%',
				]),
			},
			{
				title: 'Bayi bazlı özet',
				headers: [
					'Bayi',
					'Alış tutarı',
					'Satış geliri',
					'Satılan mal maliyeti',
					'Kâr',
				],
				rows: data.bayiReports.map((row) => [
					row.currentBayiName || row.bayiName,
					money(row.purchaseCost),
					money(row.revenue),
					money(row.costOfGoods),
					money(row.profit),
				]),
			},
			{
				title: 'Alış ve satış hareketleri',
				headers: ['Tarih', 'İşlem', 'Ürün', 'Bayi', 'Miktar', 'Tutar'],
				rows: data.movements.map((row) => [
					new Date(row.createdAt).toLocaleString('tr-TR', {
						timeZone: 'Europe/Istanbul',
					}),
					row.kind === 'purchase' ? 'Alış' : 'Satış',
					product(row),
					row.kind === 'purchase'
						? row.currentBayiName || row.bayiName || '—'
						: ('suppliers' in row ? (row.suppliers ?? []) : [])
								.map((part) => part.currentBayiName || part.bayiName)
								.join(', '),
					quantity(row.quantity, row.quantityUnit),
					money(
						row.kind === 'purchase' ? row.purchaseCost : (row.revenue ?? 0),
					),
				]),
			},
		];
		if (report.groupBy === 'memory')
			base.tables[1] = {
				title: 'Bellek boyutuna göre özet',
				headers: [
					'Bellek / ürün',
					'Satılan miktar',
					'Gelir',
					'Maliyet',
					'Kâr',
					'Kâr marjı',
				],
				rows: data.profitsByMemory.map((row) => [
					row.type
						? product({ type: row.type, memoryGb: row.memoryGb })
						: row.memoryGb + ' GB · Tüm bellek tipleri',
					quantity(row.quantity, row.quantityUnit),
					money(row.revenue),
					money(row.costOfGoods),
					money(row.profit),
					row.margin === null
						? '—'
						: row.margin.toLocaleString('tr-TR', { maximumFractionDigits: 2 }) +
							'%',
				]),
			};
		if (report.view === 'profits') base.tables = base.tables.slice(0, 3);
		else if (report.view === 'bayi')
			base.tables = [
				base.tables[0],
				base.tables[2],
				...data.bayiReports.map((bayi) => ({
					title: 'Bayi: ' + (bayi.currentBayiName || bayi.bayiName),
					headers: [
						'Ürün',
						'Alınan miktar',
						'Satılan miktar',
						'Alış tutarı',
						'Satış geliri',
						'Kâr',
					],
					rows: bayi.products.map((row) => [
						product(row),
						quantity(row.purchasedQuantity, row.quantityUnit),
						quantity(row.soldQuantity, row.quantityUnit),
						money(row.purchaseCost),
						money(row.revenue),
						money(row.profit),
					]),
				})),
			];
		base.total = data.reportTotals.profit;
		base.totalLabel = 'Gerçekleşen kâr';
	}
	const investor = query.investorId
		? await Investor.findById(query.investorId).select('name').lean()
		: null;
	if (!bayiName && (query.bayiIds?.length || query.bayiId)) {
		const bayis = await Bayi.find({
			_id: { $in: query.bayiIds?.length ? query.bayiIds : [query.bayiId] },
		})
			.select('name')
			.lean();
		bayiName = bayis
			.map((row) => row.name)
			.sort((a, b) => a.localeCompare(b, 'tr'))
			.join(', ');
	}
	base.notes = [
		'Etkin filtreler',
		...reportFilterSummary(query, {
			bayiName,
			investorName: investor?.name,
			categoryName,
		}),
	];
	return base;
}
