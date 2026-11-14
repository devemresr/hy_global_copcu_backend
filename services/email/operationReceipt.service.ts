import { stockConversionLines } from '../stockConversionLines';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import { ORDER_PRODUCT_TYPES } from '../../constants/orderProducts.constant';
import {
	operationPdfTable as purchasePdfTable,
	OPERATION_PDF_PAGE as PURCHASE_PDF_PAGE,
} from '../../assets/emails/operationPdfLayout';
import type { StoredRestock } from '../stock.service';

type Table = { title?: string; headers: string[]; rows: string[][] };
type Actor = { adminId: string; adminUsername: string };
export type OperationReceipt = {
	kind:
		| 'purchase'
		| 'sale'
		| 'finance-create'
		| 'finance-void'
		| 'conversion'
		| 'report';
	recordId: string;
	title: string;
	adminId: string;
	adminName: string;
	occurredAt: string;
	partyLabel: string;
	partyName: string;
	tables: Table[];
	notes?: string[];
	totalLabel: string;
	total: number;
	totalFormat?: 'money' | 'number';
	reportSource?: 'umami';
	reportPeriod?: string;
	delivery?: {
		mode: 'scheduled' | 'manual' | 'operation';
		jobId?: string;
		jobName?: string;
		createdBy?: { id: string; name: string };
	};
	extraAttachments?: {
		filename: string;
		contentBase64: string;
		contentType: string;
	}[];
	// Data snapshot rendered by the same document builders used by Analiz.
	analysisPdf?: { kind: 'purchase' | 'stock'; data: unknown; filters: object };
};
type SavedPurchase = {
	_id: unknown;
	name: string;
	bayiId?: unknown;
	bayiPhone?: string | null;
	createdAt: Date;
	total: number;
	quantity: number;
	unitTotals?: { piece?: number; kg?: number; g?: number } | null;
	lines: {
		type: string;
		quantity: number;
		memoryGb?: number | null;
		quantityUnit?: string;
		requiresMemorySize?: boolean | null;
		originalUnitPrice?: number | null;
		unitPrice: number;
		total: number;
		priceAdjustment?: number | null;
	}[];
};
function metadata(actor: Actor, time: Date) {
	return {
		adminId: actor.adminId,
		adminName: actor.adminUsername,
		occurredAt: time.toISOString(),
		delivery: { mode: 'operation' as const },
	};
}
export function purchaseReceipt(
	order: SavedPurchase,
	actor: Actor,
): OperationReceipt {
	const purchase = {
		_id: String(order._id),
		name: order.name,
		bayiId: order.bayiId ? String(order.bayiId) : undefined,
		bayiPhone: order.bayiPhone ?? undefined,
		createdAt: order.createdAt.toISOString(),
		total: order.total,
		quantity: order.quantity,
		unitTotals: {
			piece: order.unitTotals?.piece ?? 0,
			kg: order.unitTotals?.kg ?? 0,
			g: order.unitTotals?.g ?? 0,
		},
		lines: order.lines.map((line) => ({
			...line,
			type: line.type,
			quantityUnit: (line.quantityUnit ?? 'piece') as 'piece' | 'kg' | 'g',
		})),
	};
	const differences = purchase.lines.filter(
		(line) =>
			line.originalUnitPrice != null && line.unitPrice > line.originalUnitPrice,
	);
	return {
		kind: 'purchase',
		recordId: purchase._id,
		title: 'Alış özeti',
		...metadata(actor, order.createdAt),
		partyLabel: 'Bayi',
		partyName: order.name,
		tables: [
			{
				headers: ['Ürün', 'Miktar', 'Alış fiyatı', 'Birim fiyat', 'Tutar'],
				rows: purchase.lines.map((line) => [
					formatPurchaseProduct(line),
					formatPurchaseQuantity(line.quantity, line.quantityUnit),
					line.originalUnitPrice == null
						? '*'
						: formatPurchaseMoney(line.originalUnitPrice),
					formatPurchaseMoney(line.unitPrice),
					formatPurchaseMoney(line.total),
				]),
			},
			...(differences.length
				? [
						{
							title: 'Bu alıştaki fiyat değişiklikleri',
							headers: ['Ürün', 'Miktar', 'Birim fark', 'Toplam fark'],
							rows: differences.map((line) => [
								formatPurchaseProduct(line),
								formatPurchaseQuantity(line.quantity, line.quantityUnit),
								formatPurchaseMoney(line.unitPrice - line.originalUnitPrice!),
								formatPurchaseMoney(
									(line.unitPrice - line.originalUnitPrice!) * line.quantity,
								),
							]),
						},
					]
				: []),
		],
		notes: purchase.lines.some((line) => line.originalUnitPrice == null)
			? [
					'* Liste alış fiyatı bulunmayan ürünlerde girilen birim fiyat kullanılmıştır.',
				]
			: [],
		totalLabel: 'Genel toplam',
		total: purchase.total,
	};
}
export function saleReceipt(
	sale: StoredRestock,
	actor: Actor,
): OperationReceipt {
	const sorted = [...sale.lines].sort((a, b) => compareProductChoices(a, b));
	const productName = (line: StoredRestock['lines'][number]) =>
		formatPurchaseProduct(line);
	const parties = [
		...new Set(
			sorted.flatMap((line) =>
				(line.suppliers ?? []).map((part) => part.bayiName),
			),
		),
	].sort((a, b) => a.localeCompare(b, 'tr'));
	return {
		kind: 'sale',
		recordId: sale.requestId,
		title: 'Satış özeti',
		...metadata(actor, sale.createdAt),
		partyLabel: 'Kaynak bayiler',
		partyName: parties.join(', ') || 'Bayi bilgisi yok',
		tables: [
			{
				headers: [
					'Ürün',
					'Miktar',
					'Birim satış fiyatı',
					'Satış geliri',
					'Maliyet',
					'Kâr',
				],
				rows: sorted.map((line) => [
					productName(line),
					formatPurchaseQuantity(line.quantity, line.quantityUnit),
					formatPurchaseMoney(line.revenue / line.quantity),
					formatPurchaseMoney(line.revenue),
					formatPurchaseMoney(line.costOfGoods),
					formatPurchaseMoney(line.revenue - line.costOfGoods),
				]),
			},
			{
				title: 'Bayi dağılımı',
				headers: ['Bayi', 'Ürün', 'Miktar', 'Satış geliri', 'Maliyet', 'Kâr'],
				rows: sorted.flatMap((line) =>
					[...(line.suppliers ?? [])]
						.sort((a, b) => a.bayiName.localeCompare(b.bayiName, 'tr'))
						.map((part) => [
							part.bayiName,
							productName(line),
							formatPurchaseQuantity(part.quantity, line.quantityUnit),
							formatPurchaseMoney(part.revenue),
							formatPurchaseMoney(part.costOfGoods),
							formatPurchaseMoney(part.revenue - part.costOfGoods),
						]),
				),
			},
		],
		totalLabel: 'Satış toplamı',
		total: sale.totalRevenue,
	};
}
export function financeReceipt(
	entry: {
		_id?: string | null;
		group: string;
		subtype: string;
		amountCents: number;
		date: string;
		description: string;
		investorName?: string | null;
		createdAt: Date;
	},
	actor: Actor,
	action: 'create' | 'void',
	time = new Date(),
): OperationReceipt {
	const direction = entry.group === 'other' ? 'Gider' : 'Gelir';
	return {
		kind: action === 'create' ? 'finance-create' : 'finance-void',
		recordId: String(entry._id),
		title:
			action === 'create'
				? 'Bakiye kaydı eklendi'
				: 'Bakiye kaydı iptal edildi',
		...metadata(actor, action === 'create' ? entry.createdAt : time),
		partyLabel: 'Yatırımcı',
		partyName: entry.investorName || 'Bu işlemde yatırımcı yok',
		tables: [
			{
				headers: ['Ana tür', 'Alt tür', 'İşlem tarihi', 'Açıklama', 'Tutar'],
				rows: [
					[
						direction,
						entry.subtype,
						entry.date,
						entry.description || '—',
						formatPurchaseMoney(entry.amountCents / 100),
					],
				],
			},
		],
		totalLabel:
			action === 'create' ? direction + ' tutarı' : 'İptal edilen tutar',
		total: entry.amountCents / 100,
	};
}
export function conversionReceipt(
	conversion: Awaited<
		ReturnType<
			typeof import('../stockConversion.service').recordStockConversion
		>
	>['conversion'],
	actor: Actor,
): OperationReceipt {
	const lines = stockConversionLines(conversion);
	return {
		kind: 'conversion',
		recordId: String(conversion._id),
		title: 'Stok birimi dönüşümü',
		...metadata(actor, conversion.createdAt),
		partyLabel: 'Bayiler',
		partyName: [...new Set(lines.map((line) => line.bayiName))].join(', '),
		tables: [
			{
				title: 'Dönüştürülen stoklar',
				headers: [
					'Ürün',
					'Bayi',
					'Kaynak alış',
					'Düşülen miktar',
					'Yeni miktar',
					'Korunan maliyet',
				],
				rows: lines.map((line) => [
					formatPurchaseProduct(line),
					line.bayiName,
					line.orderId,
					formatPurchaseQuantity(line.fromQuantity, line.fromUnit),
					formatPurchaseQuantity(line.toQuantity, line.toUnit),
					formatPurchaseMoney(line.cost),
				]),
			},
		],
		notes: [
			'Bayi sahipliği ve maliyet korunmuştur. Bu dönüşüm gelir veya gider oluşturmaz.',
			...(conversion.note ? [conversion.note] : []),
		],
		totalLabel: 'Korunan toplam stok maliyeti',
		total: lines.reduce((sum, line) => sum + line.cost, 0),
	};
}
export const formatPurchaseMoney = (value: number) =>
	value.toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' });
export const formatPurchaseQuantity = (value: number, unit = 'piece') =>
	value.toLocaleString('tr-TR', { maximumFractionDigits: 3 }) +
	' ' +
	(unit === 'piece' ? 'adet' : unit);
export function formatPurchaseProduct(line: {
	type: string;
	memoryGb?: number | null;
	requiresMemorySize?: boolean | null;
}) {
	const type =
		ORDER_PRODUCT_TYPES[line.type as keyof typeof ORDER_PRODUCT_TYPES];
	return (
		type.label +
		((line.requiresMemorySize ?? type.requiresMemorySize) &&
		line.memoryGb != null
			? ' – ' + (line.memoryGb === 1024 ? '1 TB' : line.memoryGb + ' GB')
			: '')
	);
}
function compareProductChoices(
	a: { type: string; memoryGb?: number | null },
	b: { type: string; memoryGb?: number | null },
) {
	const order = ['EMMC', 'EMCP', 'IPHONE', 'TABLET'];
	const memoryA =
		ORDER_PRODUCT_TYPES[a.type as keyof typeof ORDER_PRODUCT_TYPES]
			.requiresMemorySize;
	const memoryB =
		ORDER_PRODUCT_TYPES[b.type as keyof typeof ORDER_PRODUCT_TYPES]
			.requiresMemorySize;
	return (
		Number(memoryB) - Number(memoryA) ||
		(memoryA && memoryB ? (a.memoryGb ?? 0) - (b.memoryGb ?? 0) : 0) ||
		order.indexOf(a.type) - order.indexOf(b.type)
	);
}
const escape = (value: string) =>
	value.replace(
		/[&<>"']/g,
		(char) =>
			({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
				char
			]!,
	);
export function receiptMetadata(receipt: OperationReceipt) {
	const mode = receipt.delivery?.mode;
	const actor = receipt.adminName + ' (' + receipt.adminId + ')';
	return [
		...(mode
			? [
					'Gönderim: ' +
						{
							scheduled: 'Otomatik · Zamanlanmış görev',
							manual: 'Manuel · Yönetici tarafından başlatıldı',
							operation: 'Otomatik · İşlem kaydı sonrası',
						}[mode],
				]
			: []),
		...(receipt.delivery?.jobName
			? ['Rapor görevi: ' + receipt.delivery.jobName]
			: []),
		...(mode === 'scheduled'
			? []
			: [
					(mode === 'manual'
						? 'Gönderimi başlatan yönetici: '
						: 'İşlemi yapan yönetici: ') + actor,
				]),
		...(receipt.delivery?.createdBy
			? [
					'Görevi oluşturan yönetici: ' +
						receipt.delivery.createdBy.name +
						' (' +
						receipt.delivery.createdBy.id +
						')',
				]
			: mode === 'scheduled'
				? ['Görevi oluşturan yönetici: ' + actor]
				: []),
		(receipt.kind === 'report'
			? 'Rapor oluşturulma zamanı: '
			: 'İşlem zamanı: ') +
			new Date(receipt.occurredAt).toLocaleString('tr-TR', {
				timeZone: 'Europe/Istanbul',
			}) +
			' (İstanbul)',
		receipt.partyLabel + ': ' + receipt.partyName,
		...(receipt.reportPeriod ? ['Rapor dönemi: ' + receipt.reportPeriod] : []),
		'Kayıt kimliği: ' + receipt.recordId,
	];
}
function receiptNotes(receipt: OperationReceipt) {
	return [
		...new Set(
			(receipt.notes ?? [])
				.map((note) => note.trim())
				.filter(
					(note) =>
						note && !(receipt.reportPeriod && note.startsWith('Rapor dönemi:')),
				),
		),
	];
}
export function operationEmail(
	receipt: OperationReceipt,
	options: { includePdf?: boolean } = {},
) {
	const summary = receiptMetadata(receipt);
	const notes = receiptNotes(receipt);
	const isUmami =
		receipt.reportSource === 'umami' ||
		(receipt.kind === 'report' &&
			receipt.totalFormat === 'number' &&
			receipt.partyName.startsWith('Umami'));
	const text = [
		receipt.title,
		...summary,
		...receipt.tables.flatMap((table) => [
			table.title ?? '',
			table.headers.join(' | '),
			...table.rows.map((row) => row.join(' | ')),
		]),
		...notes,
		receipt.totalLabel +
			': ' +
			(receipt.totalFormat === 'number'
				? receipt.total.toLocaleString('tr-TR')
				: formatPurchaseMoney(receipt.total)),
		options.includePdf === false
			? 'PDF eki kapalı; bu e-posta yalnızca özeti içerir.'
			: 'Ayrıntılı PDF dosyası e-postaya eklenmiştir.',
	].join('\n');
	const incomeColor = '#047857',
		costColor = '#be123c';
	const tableHtml = receipt.tables
		.filter((table) => table.rows.length)
		.map((table) => {
			const headerHtml = table.headers
				.map(
					(header) =>
						'<th scope="col" style="padding:10px 8px;text-align:left;background-color:#172554;color:#ffffff;border-bottom:2px solid #3b82f6;font-size:12px">' +
						escape(header) +
						'</th>',
				)
				.join('');
			const rows = table.rows
				.map((row, index) => {
					const direction = isUmami
						? null
						: row.includes('Gelir') || row.includes('Satış')
							? 'income'
							: row.includes('Gider') || row.includes('Alış')
								? 'cost'
								: receipt.kind === 'purchase'
									? 'cost'
									: receipt.kind === 'sale'
										? 'income'
										: null;
					const background = index % 2 === 0 ? '#ffffff' : '#eff6ff';
					return (
						'<tr bgcolor="' +
						background +
						'">' +
						row
							.map((cell, column) => {
								const header = table.headers[column] ?? '';
								const signed = /kâr|net|bakiye/i.test(header);
								const cost = /maliyet|gider|alış/i.test(header);
								const income = /gelir|satış/i.test(header);
								const amount = /tutar|toplam|fiyat/i.test(header);
								const numeric = isUmami
									? /[0-9]/.test(cell) && /Tekrar|Pay|Değer|Sayı/.test(header)
									: /[0-9]/.test(cell) &&
										(signed ||
											((cost || income || amount) && /₺|TL|TRY/.test(cell)));
								const color = isUmami
									? numeric
										? '#1d4ed8'
										: '#334155'
									: numeric
										? signed
											? /^[−-]/.test(cell.trim())
												? costColor
												: incomeColor
											: cost
												? costColor
												: income
													? incomeColor
													: direction === 'cost'
														? costColor
														: direction === 'income'
															? incomeColor
															: '#0f172a'
										: '#334155';
								return (
									'<td style="padding:10px 8px;border-bottom:1px solid #dbeafe;background-color:' +
									background +
									';color:' +
									color +
									';font-weight:' +
									(numeric ? '600' : '400') +
									';vertical-align:top;overflow-wrap:anywhere;word-break:break-word;' +
									(column === 0 && direction
										? 'border-left:3px solid ' +
											(direction === 'cost' ? costColor : incomeColor) +
											';'
										: '') +
									'">' +
									escape(cell) +
									'</td>'
								);
							})
							.join('') +
						'</tr>'
					);
				})
				.join('');
			return (
				(table.title
					? '<h2 style="margin:24px 0 10px;font-size:16px;color:#1e3a8a">' +
						escape(table.title) +
						'</h2>'
					: '') +
				'<table width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed"><thead><tr>' +
				headerHtml +
				'</tr></thead><tbody>' +
				rows +
				'</tbody></table>'
			);
		})
		.join('');
	const pdfNotice =
		options.includePdf === false
			? 'PDF eki kapalı; bu e-posta yalnızca özeti içerir.'
			: 'Ayrıntılı PDF dosyası e-postanın ekler bölümündedir. Önizleme görünmüyorsa eki indirerek açabilirsiniz.';
	const notesHtml = notes.length
		? '<div style="margin-top:20px;padding:12px;background-color:#eff6ff;border-left:3px solid #3b82f6">' +
			notes
				.map(
					(note) =>
						'<p style="margin:5px 0;font-size:12px">' + escape(note) + '</p>',
				)
				.join('') +
			'</div>'
		: '';
	const html =
		'<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background-color:#eaf0f8;font-family:Arial,sans-serif;color:#0f172a"><div style="max-width:900px;margin:0 auto;background-color:#ffffff;padding:20px"><div style="background-color:#172554;color:#ffffff;padding:20px;border-radius:8px"><p style="margin:0 0 8px;font-size:12px;color:#bfdbfe">HY GLOBAL ÇÖPÇÜ</p><h1 style="margin:0;font-size:22px">' +
		escape(receipt.title) +
		'</h1></div><div style="padding:10px 0">' +
		summary
			.map(
				(line) =>
					'<p style="margin:7px 0;font-size:12px;color:#475569">' +
					escape(line) +
					'</p>',
			)
			.join('') +
		'</div>' +
		(isUmami
			? ''
			: '<p style="font-size:11px;color:#475569"><span style="color:' +
				incomeColor +
				'">● Gelir / satış</span> &nbsp; <span style="color:' +
				costColor +
				'">● Gider / maliyet</span></p>') +
		tableHtml +
		notesHtml +
		'<p style="padding:14px;background-color:#172554;color:#ffffff;font-size:16px;font-weight:bold;border-radius:6px">' +
		escape(receipt.totalLabel) +
		': ' +
		escape(
			receipt.totalFormat === 'number'
				? receipt.total.toLocaleString('tr-TR')
				: formatPurchaseMoney(receipt.total),
		) +
		'</p><p style="font-size:12px;color:#475569">' +
		pdfNotice +
		'</p></div></body></html>';
	const prefix =
		receipt.delivery?.mode === 'manual'
			? '[Manuel] '
			: receipt.delivery
				? '[Otomatik] '
				: '';
	return { subject: 'HY Global Çöpçü · ' + prefix + receipt.title, text, html };
}
export function operationDocument(
	receipt: OperationReceipt,
): TDocumentDefinitions {
	const metadataContent: Content[] = receiptMetadata(receipt).map((text) => ({
		text,
		fontSize: 10,
		margin: [0, 0, 0, 5],
	}));

	return {
		...PURCHASE_PDF_PAGE,
		info: { title: receipt.title, author: receipt.adminName },
		content: [
			{ text: receipt.title, fontSize: 18, bold: true, margin: [0, 0, 0, 12] },
			...metadataContent,
			...receipt.tables
				.filter((table) => table.rows.length)
				.flatMap((table) => [
					...(table.title
						? [
								{
									text: table.title,
									bold: true,
									margin: [0, 14, 0, 6],
								} as Content,
							]
						: []),
					purchasePdfTable(table.headers, table.rows),
				]),
			...receiptNotes(receipt).map(
				(text) => ({ text, fontSize: 9, margin: [0, 10, 0, 0] }) as Content,
			),
			{
				text:
					receipt.totalLabel +
					': ' +
					(receipt.totalFormat === 'number'
						? receipt.total.toLocaleString('tr-TR')
						: formatPurchaseMoney(receipt.total)),
				bold: true,
				alignment: 'right',
				margin: [0, 16, 0, 0],
			},
		],
	};
}
