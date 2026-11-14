// Generated from the frontend Analiz PDF builders. Do not edit. Run npm run sync:report-pdf in server.

// ../frontend/src/app/constants/purchaseProducts.constant.ts
var PURCHASE_PRODUCT_TYPES = {
	EMMC: { label: 'eMMC', requiresMemorySize: true },
	EMCP: { label: 'eMCP', requiresMemorySize: true },
	IPHONE: { label: 'iPhone', requiresMemorySize: false },
	TABLET: { label: 'Tablet', requiresMemorySize: false },
};
var PURCHASE_PRODUCT_TYPE_ORDER = ['EMMC', 'EMCP', 'IPHONE', 'TABLET'];
var PURCHASE_QUANTITY_UNIT_LABELS = {
	piece: 'adet',
	kg: 'kg',
	g: 'g',
};

// ../frontend/src/app/helpers/purchaseChoices.helper.ts
function compareProductChoices(a, b) {
	const memoryA = PURCHASE_PRODUCT_TYPES[a.type].requiresMemorySize,
		memoryB = PURCHASE_PRODUCT_TYPES[b.type].requiresMemorySize;
	return (
		Number(memoryB) - Number(memoryA) ||
		(memoryA && memoryB ? (a.memoryGb ?? 0) - (b.memoryGb ?? 0) : 0) ||
		PURCHASE_PRODUCT_TYPE_ORDER.indexOf(a.type) -
			PURCHASE_PRODUCT_TYPE_ORDER.indexOf(b.type)
	);
}

// ../frontend/src/app/helpers/productDistribution.helper.ts
function productDistribution(lines) {
	const groups = /* @__PURE__ */ new Map();
	for (const line of lines) {
		const quantityUnit = line.quantityUnit ?? 'piece';
		const key = `${line.type}:${line.memoryGb ?? '-'}:${quantityUnit}`;
		const group = groups.get(key) ?? {
			...line,
			quantityUnit,
			quantity: 0,
			total: 0,
		};
		group.quantity += line.quantity;
		group.total += line.total;
		groups.set(key, group);
	}
	return [...groups.values()].sort((a, b) =>
		compareProductChoices(
			{ ...a, memoryGb: a.memoryGb ?? null },
			{ ...b, memoryGb: b.memoryGb ?? null },
		),
	);
}

// ../frontend/src/app/helpers/numericFilterLabel.helper.ts
var NUMERIC_FIELDS = {
	total: '\u0130\u015Flem toplam\u0131 (TL)',
	productMatch: 'Ek say\u0131sal ko\u015Ful yok',
	recordPiece: 'Al\u0131\u015F toplam miktar\u0131 (adet)',
	recordKg: 'Al\u0131\u015F toplam miktar\u0131 (kg)',
	recordG: 'Al\u0131\u015F toplam miktar\u0131 (g)',
	lineCount: 'Al\u0131\u015Ftaki \xFCr\xFCn sat\u0131r\u0131 say\u0131s\u0131',
	memoryGb: 'Bellek boyutu (GB)',
	quantityPiece: '\xDCr\xFCn miktar\u0131 (adet)',
	quantityKg: '\xDCr\xFCn miktar\u0131 (kg)',
	quantityG: '\xDCr\xFCn miktar\u0131 (g)',
	unitPricePiece: 'Birim al\u0131\u015F fiyat\u0131 (TL/adet)',
	unitPriceKg: 'Birim al\u0131\u015F fiyat\u0131 (TL/kg)',
	unitPriceG: 'Birim al\u0131\u015F fiyat\u0131 (TL/g)',
	originalUnitPricePiece: 'Liste al\u0131\u015F fiyat\u0131 (TL/adet)',
	originalUnitPriceKg: 'Liste al\u0131\u015F fiyat\u0131 (TL/kg)',
	originalUnitPriceG: 'Liste al\u0131\u015F fiyat\u0131 (TL/g)',
	priceAdjustmentPiece: 'Birim fiyat fark\u0131 (TL/adet)',
	priceAdjustmentKg: 'Birim fiyat fark\u0131 (TL/kg)',
	priceAdjustmentG: 'Birim fiyat fark\u0131 (TL/g)',
	totalAdjustment: 'Toplam fiyat fark\u0131 (TL)',
	purchaseCost: 'Al\u0131\u015F maliyeti (TL)',
	revenue: 'Sat\u0131\u015F geliri (TL)',
	profit: 'Ger\xE7ekle\u015Fen k\xE2r (TL)',
	margin: 'K\xE2r marj\u0131 (%)',
	sellingPricePiece: 'Birim sat\u0131\u015F fiyat\u0131 (TL/adet)',
	sellingPriceKg: 'Birim sat\u0131\u015F fiyat\u0131 (TL/kg)',
	sellingPriceG: 'Birim sat\u0131\u015F fiyat\u0131 (TL/g)',
};
function numericFilterLabel(filter) {
	const names = {
		EMMC: 'eMMC',
		EMCP: 'eMCP',
		IPHONE: 'iPhone',
		TABLET: 'Tablet',
	};
	const scope = filter.productType
		? names[filter.productType] +
			(filter.productType === 'EMMC' || filter.productType === 'EMCP'
				? filter.memoryGb === void 0
					? ' \xB7 t\xFCm boyutlar'
					: ' \xB7 ' + filter.memoryGb + ' GB'
				: '')
		: ['total', 'recordPiece', 'recordKg', 'recordG', 'lineCount'].includes(
					filter.field,
			  )
			? '\u0130\u015Flem geneli'
			: 'T\xFCm \xFCr\xFCnler';
	if (filter.field === 'productMatch') return '\xDCr\xFCn i\xE7erir: ' + scope;
	return `${scope} \u2192 ${NUMERIC_FIELDS[filter.field]}: ${filter.min?.toLocaleString('tr-TR', { maximumFractionDigits: 6 }) ?? 'Alt s\u0131n\u0131r yok'} \u2013 ${filter.max?.toLocaleString('tr-TR', { maximumFractionDigits: 6 }) ?? '\xDCst s\u0131n\u0131r yok'}`;
}

// ../frontend/src/app/helpers/reportFilterSummary.helper.ts
function reportFilterSummary(filters, names = {}) {
	const productNames = {
		EMMC: 'eMMC',
		EMCP: 'eMCP',
		IPHONE: 'iPhone',
		TABLET: 'Tablet',
	};
	const movements = {
		'all-movements': 'T\xFCm hareketler',
		'purchase-entries': 'Al\u0131\u015Flar',
		'all-sales': 'T\xFCm sat\u0131\u015Flar',
		'full-stock-sales': 'Tam sat\u0131\u015Flar',
		'partial-sales': 'K\u0131smi sat\u0131\u015Flar',
	};
	const groups = {
		purchase: 'Mal al\u0131\u015F',
		sale: 'Sat\u0131\u015F',
		other: 'Gider',
		investment: 'Gelir',
	};
	const result = [
		`Tarih: ${filters.from ?? 'Ba\u015Flang\u0131\xE7 s\u0131n\u0131r\u0131 yok'} \u2013 ${filters.until ?? 'Biti\u015F s\u0131n\u0131r\u0131 yok'} (\u0130stanbul)`,
	];
	if (filters.bayiIds?.length || filters.bayiId || filters.bayiName)
		result.push(
			'Bayi: ' +
				(names.bayiName ||
					filters.bayiName ||
					filters.bayiIds?.join(', ') ||
					filters.bayiId),
		);
	if (filters.investorId)
		result.push(
			'Yat\u0131r\u0131mc\u0131: ' + (names.investorName || filters.investorId),
		);
	if (filters.categoryId)
		result.push(
			'Gelir / gider t\xFCr\xFC: ' + (names.categoryName || filters.categoryId),
		);
	if (filters.direction)
		result.push(
			'Y\xF6n: ' + (filters.direction === 'income' ? 'Gelir' : 'Gider'),
		);
	if (filters.group)
		result.push('Ana t\xFCr: ' + (groups[filters.group] ?? filters.group));
	if (filters.movementType)
		result.push(
			'Hareket: ' + (movements[filters.movementType] ?? filters.movementType),
		);
	if (filters.productType)
		result.push(
			'\xDCr\xFCn: ' +
				(productNames[filters.productType] ?? filters.productType) +
				(filters.memoryGb === void 0 ? '' : ' ' + filters.memoryGb + ' GB'),
		);
	if (filters.purchaseId)
		result.push('Kaynak al\u0131\u015F: ' + filters.purchaseId);
	if (filters.minTotal !== void 0 || filters.maxTotal !== void 0)
		result.push(
			numericFilterLabel({
				field: 'total',
				min: filters.minTotal,
				max: filters.maxTotal,
			}),
		);
	result.push(...(filters.numericFilters ?? []).map(numericFilterLabel));
	if (filters.excludeIds?.length)
		result.push(
			`Se\xE7im d\u0131\u015F\u0131nda b\u0131rak\u0131lan al\u0131\u015F: ${filters.excludeIds.length}`,
		);
	if (filters.excludeSaleIds?.length)
		result.push(
			`Se\xE7im d\u0131\u015F\u0131nda b\u0131rak\u0131lan sat\u0131\u015F: ${filters.excludeSaleIds.length}`,
		);
	return result;
}

// ../frontend/src/app/helpers/purchasePdfLayout.helper.ts
var PURCHASE_PDF_PAGE = {
	pageSize: 'A4',
	pageMargins: [32, 40, 32, 44],
	defaultStyle: { font: 'Roboto', fontSize: 9, lineHeight: 1.15 },
	pageBreakBefore: (node, container) =>
		node.headlineLevel === 1 &&
		container.getFollowingNodesOnPage().length === 0,
};
var PURCHASE_PDF_CONTENT_WIDTH = 595.28 - 32 - 32 - 2;
var CELL_PADDING = 4;
var layout = {
	hLineWidth: () => 0.5,
	vLineWidth: () => 0,
	hLineColor: () => '#dddddd',
	paddingLeft: () => CELL_PADDING,
	paddingRight: () => CELL_PADDING,
	paddingTop: () => 5,
	paddingBottom: () => 5,
};
function pdfWrapText(value) {
	return String(value)
		.replace(/[\u00a0\u202f]/g, ' ')
		.replace(/[^\s\u200b]{13,}/gu, (word) => {
			const characters = Array.from(word);
			return characters
				.map(
					(character, index) =>
						`${index > 0 && index % 12 === 0 ? '\u200B' : ''}${character}`,
				)
				.join('');
		});
}
function purchasePdfTable(
	headers,
	rows,
	weights = headers.map(() => 1),
	headerColor = '#eeeeee',
) {
	const usable = PURCHASE_PDF_CONTENT_WIDTH - headers.length * CELL_PADDING * 2;
	const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
	return {
		fontSize: headers.length >= 6 ? 8 : 9,
		table: {
			headerRows: 1,
			// Rows may span pages, including a row taller than an entire page.
			dontBreakRows: false,
			keepWithHeaderRows: 0,
			widths: weights.map((weight) => (usable * weight) / totalWeight),
			body: [
				headers.map((text) => ({
					text: pdfWrapText(text),
					bold: true,
					fillColor: headerColor,
				})),
				...rows.map((row) =>
					row.map((value) => ({ text: pdfWrapText(value), noWrap: false })),
				),
			],
		},
		layout,
	};
}

// ../frontend/src/app/constants/purchaseReports.constant.ts
var formatPurchaseMoney = (value) =>
	value.toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' });

// ../frontend/src/app/helpers/purchasePeriod.helper.ts
function istanbulToday(now = /* @__PURE__ */ new Date()) {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Europe/Istanbul',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).formatToParts(now);
	const part = (type) => parts.find((entry) => entry.type === type).value;
	return `${part('year')}-${part('month')}-${part('day')}`;
}

// ../frontend/src/app/helpers/purchaseProduct.helper.ts
function formatPurchaseProduct(line) {
	const product = PURCHASE_PRODUCT_TYPES[line.type];
	return `${product.label}${(line.requiresMemorySize ?? product.requiresMemorySize) && line.memoryGb != null ? ` \u2013 ${line.memoryGb === 1024 ? '1 TB' : `${line.memoryGb} GB`}` : ''}`;
}
function formatPurchaseQuantity(quantity, quantityUnit = 'piece') {
	return `${quantity.toLocaleString('tr-TR', { maximumFractionDigits: 3 })} ${PURCHASE_QUANTITY_UNIT_LABELS[quantityUnit]}`;
}
function formatPurchaseUnitTotals(data) {
	const totals = data.unitTotals ?? { piece: data.quantity, kg: 0, g: 0 };
	return (
		Object.keys(PURCHASE_QUANTITY_UNIT_LABELS)
			.filter((unit) => totals[unit] > 0)
			.map((unit) => formatPurchaseQuantity(totals[unit], unit))
			.join(' \xB7 ') || '0 adet'
	);
}

// ../frontend/src/app/helpers/purchaseReport.helper.ts
function purchaseReportDocument(data, filters, _charts) {
	const table = (title, headers, rows, headerColor = '#eeeeee') => [
		{
			text: title,
			headlineLevel: 1,
			fontSize: 13,
			bold: true,
			margin: [0, 18, 0, 8],
		},
		purchasePdfTable(
			headers,
			rows,
			headers.length === 6
				? [1.9, 0.7, 1.3, 1.3, 1.2, 1.4]
				: headers.map(() => 1),
			headerColor,
		),
	];
	const adjustments = data.adjustments ?? [];
	const missingListPrices = data.missingListPrices ?? [];
	const signedMoney = (value) =>
		`${value > 0 ? '+' : ''}${formatPurchaseMoney(value)}`;
	return {
		...PURCHASE_PDF_PAGE,
		info: { title: 'Al\u0131\u015F raporu', author: 'HY Global' },
		content: [
			{
				text: 'Al\u0131\u015F raporu',
				fontSize: 20,
				bold: true,
				margin: [0, 0, 0, 10],
			},
			{ text: 'Etkin filtreler', bold: true, margin: [0, 0, 0, 4] },
			...reportFilterSummary(filters, { bayiName: data.bayiFilterName }).map(
				(text) => ({
					text,
					fontSize: 9,
					margin: [0, 0, 0, 4],
				}),
			),
			{
				text: `${data.summary.count} al\u0131\u015F \xB7 ${formatPurchaseUnitTotals(data.summary)} \xB7 ${formatPurchaseMoney(data.summary.total)}`,
				bold: true,
				fontSize: 12,
			},
			{
				text: `Genel toplam: ${formatPurchaseMoney(data.summary.total)}`,
				bold: true,
				fontSize: 16,
				margin: [0, 10, 0, 4],
			},
			/* Graph content temporarily disabled.
			...(charts.length
				? [
						{
							text: 'Özet ve grafikler rapora dahil edilen alışları kapsar. Tutar grafiği yalnızca işlem yapılan günleri gösterir.',
							color: '#555555',
							margin: [0, 8, 0, 12],
						} satisfies Content,
					]
				: []),
      */
			/* Graphs and date visualizations temporarily disabled.
			...pdfChartsSection(charts),
			...charts
				.filter((chart) => chart.kind === 'daily' && chart.view)
				.flatMap((chart) => purchaseDatePdf(data.timeline ?? [], chart.view!)),
      */
			...(missingListPrices.length
				? [
						...table(
							'al\u0131\u015F fiyat\u0131 bulunmayan \xFCr\xFCnler *',
							['Al\u0131\u015F / \xDCr\xFCn', 'Miktar', 'Birim fiyat', 'Tutar'],
							missingListPrices.map((line) => [
								`${line.orderName}
${formatPurchaseProduct(line)}`,
								formatPurchaseQuantity(line.quantity, line.quantityUnit),
								`${formatPurchaseMoney(line.unitPrice)} *`,
								formatPurchaseMoney(line.total),
							]),
						),
						{
							text: '* al\u0131\u015F fiyat\u0131 bulunmad\u0131\u011F\u0131ndan fiyat fark\u0131 hesaplanamam\u0131\u015Ft\u0131r. Girilen birim fiyat kullan\u0131lm\u0131\u015Ft\u0131r.',
							fontSize: 9,
							color: '#555555',
							margin: [0, 8, 0, 12],
						},
					]
				: []),
			{
				text: 'Al\u0131\u015Fa \xF6zel fiyat de\u011Fi\u015Fiklikleri',
				fontSize: 13,
				bold: true,
				margin: [0, 18, 0, 8],
			},
			{
				text: 'Al\u0131\u015F fiyat\u0131, al\u0131\u015F kaydedildi\u011Fi andaki fiyatt\u0131r. Birim fark = uygulanan fiyat \u2212 al\u0131\u015F fiyat\u0131. Toplam fark = birim fark \xD7 miktar. Bu kay\u0131tlar g\xFCncel fiyat listesi de\u011Fi\u015Fse de korunur.',
				color: '#555555',
				margin: [0, 0, 0, 8],
			},
			...(adjustments.length
				? table(
						'Fiyat de\u011Fi\u015Fikli\u011Fi d\xF6k\xFCm\xFC',
						[
							'Al\u0131\u015F / \xDCr\xFCn',
							'Miktar',
							'Al\u0131\u015F fiyat\u0131',
							'Uygulanan birim fiyat',
							'Birim fark',
							'Toplam fark',
						],
						adjustments.map((row) => [
							`${row.orderName}
${new Date(row.createdAt).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })}
${formatPurchaseProduct(row)}`,
							formatPurchaseQuantity(row.quantity, row.quantityUnit),
							`${formatPurchaseMoney(row.originalUnitPrice)}`,
							formatPurchaseMoney(row.unitPrice),
							signedMoney(row.priceAdjustment),
							signedMoney(row.totalAdjustment),
						]),
						'#eeeeee',
					)
				: [
						{
							text: 'Se\xE7ili al\u0131\u015Flarda fiyat de\u011Fi\u015Fikli\u011Fi kayd\u0131 yok.',
							color: '#666666',
						},
					]),
			...table(
				'\xDCr\xFCn t\xFCr\xFC da\u011F\u0131l\u0131m\u0131',
				['\xDCr\xFCn', 'Miktar', 'Tutar'],
				productDistribution(
					data.byTypeAndMemory ?? data.orders.flatMap((order) => order.lines),
				).map((row) => [
					formatPurchaseProduct(row),
					formatPurchaseQuantity(row.quantity, row.quantityUnit),
					formatPurchaseMoney(row.total),
				]),
			),
			...(data.byMemory.length
				? table(
						'Bellek da\u011F\u0131l\u0131m\u0131',
						['Bellek', 'Adet', 'Tutar'],
						data.byMemory.map((row) => [
							`${row._id} GB`,
							row.quantity,
							formatPurchaseMoney(row.total),
						]),
					)
				: []),
			...table(
				'Tarihlere g\xF6re toplamlar',
				['Tarih', 'Al\u0131\u015F', 'Tutar'],
				data.daily.map((day) => [
					day._id,
					day.count,
					formatPurchaseMoney(day.total),
				]),
			),
		],
		footer: (page, pages) => ({
			text: `${page} / ${pages}`,
			alignment: 'center',
			fontSize: 8,
		}),
	};
}

// ../frontend/src/app/helpers/stockSaleReport.helper.ts
function stockSaleReportDocument(data, filters) {
	const includesPurchases =
		!filters.movementType ||
		filters.movementType === 'all-movements' ||
		filters.movementType === 'purchase-entries';
	const title = includesPurchases
		? 'Stok hareketleri raporu'
		: 'Sat\u0131\u015F raporu';
	const generatedAt =
		data.reportGeneratedAt ?? /* @__PURE__ */ new Date().toISOString();
	const products =
		data.productSummary ??
		data.profits.flatMap((row) =>
			row.type === null
				? []
				: [
						{
							...row,
							type: row.type,
							purchaseQuantity: 0,
							purchaseTotal: 0,
							soldQuantity: row.quantity,
							currentQuantity:
								data.positions.find(
									(position) =>
										position.type === row.type &&
										position.memoryGb === row.memoryGb &&
										position.quantityUnit === row.quantityUnit,
								)?.quantity ?? 0,
							averagePurchasePrice: row.averagePurchaseCost,
							averageSellingPrice: row.averageSellingPrice,
						},
					],
		);
	const supplierMap = /* @__PURE__ */ new Map();
	for (const row of data.profitsByBayi ?? []) {
		const key = row.bayiId ?? 'unlinked:' + row.bayiName;
		const group = supplierMap.get(key) ?? {
			key,
			name: row.currentBayiName || row.bayiName,
			rows: [],
		};
		group.rows.push(row);
		supplierMap.set(key, group);
	}
	const supplierGroups = [...supplierMap.values()].sort(
		(a, b) =>
			a.name.localeCompare(b.name, 'tr', { sensitivity: 'base' }) ||
			a.key.localeCompare(b.key),
	);
	function datedRows(group) {
		const days = /* @__PURE__ */ new Map();
		for (const sale of data.reportSales ?? []) {
			const date = istanbulToday(new Date(sale.createdAt));
			for (const line of sale.lines) {
				for (const part of line.suppliers ?? []) {
					if ((part.bayiId ?? 'unlinked:' + part.bayiName) !== group.key)
						continue;
					const rows = days.get(date) ?? /* @__PURE__ */ new Map();
					const key = line.type + ':' + line.memoryGb + ':' + line.quantityUnit;
					const row = rows.get(key) ?? {
						...part,
						type: line.type,
						memoryGb: line.memoryGb,
						quantityUnit: line.quantityUnit,
						quantity: 0,
						revenue: 0,
						costOfGoods: 0,
						profit: 0,
						margin: null,
					};
					row.quantity += part.quantity;
					row.revenue += part.revenue;
					row.costOfGoods += part.costOfGoods;
					row.profit = row.revenue - row.costOfGoods;
					row.margin =
						row.revenue > 0 ? (row.profit / row.revenue) * 100 : null;
					rows.set(key, row);
					days.set(date, rows);
				}
			}
		}
		return days.size
			? [...days]
					.sort(([a], [b]) => b.localeCompare(a))
					.map(([date, rows]) => ({ date, rows: [...rows.values()] }))
			: [{ date: null, rows: group.rows }];
	}
	return {
		...PURCHASE_PDF_PAGE,
		info: { title, author: 'HY Global' },
		content: [
			{ text: title, fontSize: 20, bold: true, margin: [0, 0, 0, 10] },
			{ text: 'Etkin filtreler', bold: true, margin: [0, 0, 0, 4] },
			...reportFilterSummary(filters, { bayiName: data.bayiFilterName }).map(
				(text) => ({
					text,
					fontSize: 9,
					margin: [0, 0, 0, 4],
				}),
			),
			{
				text: `Se\xE7ili filtrelere ve sat\u0131\u015F se\xE7imine uyan ${data.selectedSaleCount ?? data.operations.length} sat\u0131\u015F dahildir. Ekran sayfalamas\u0131 (pagination) raporu s\u0131n\u0131rlamaz.${includesPurchases ? ' Filtrelenen al\u0131\u015Flar da rapora dahildir.' : ''}`,
				color: '#555555',
				margin: [0, 8, 0, 12],
			},
			purchasePdfTable(
				[
					...(includesPurchases ? ['Al\u0131\u015F tutar\u0131'] : []),
					'Sat\u0131\u015F geliri',
					'Sat\u0131lan mal maliyeti',
					'Ger\xE7ekle\u015Fen k\xE2r',
				],
				[
					[
						...(includesPurchases
							? [formatPurchaseMoney(data.reportTotals.purchaseCost)]
							: []),
						formatPurchaseMoney(data.reportTotals.revenue),
						formatPurchaseMoney(
							data.reportTotals.costOfGoods ??
								data.profits.reduce((sum, row) => sum + row.costOfGoods, 0),
						),
						formatPurchaseMoney(data.reportTotals.profit),
					],
				],
			),
			{
				text: '\xDCr\xFCn ve bellek bazl\u0131 al\u0131\u015F / sat\u0131\u015F \xF6zeti',
				headlineLevel: 1,
				fontSize: 13,
				bold: true,
				margin: [0, 18, 0, 8],
			},
			purchasePdfTable(
				[
					'\xDCr\xFCn',
					'Al\u0131nan miktar',
					'Al\u0131\u015F tutar\u0131',
					'Sat\u0131lan miktar',
					'Sat\u0131\u015F geliri',
					'Br\xFCt k\xE2r',
				],
				[...products]
					.sort(
						(a, b) =>
							compareProductChoices(a, b) ||
							a.quantityUnit.localeCompare(b.quantityUnit),
					)
					.map((row) => [
						formatPurchaseProduct(row),
						formatPurchaseQuantity(row.purchaseQuantity, row.quantityUnit),
						formatPurchaseMoney(row.purchaseTotal),
						formatPurchaseQuantity(row.soldQuantity, row.quantityUnit),
						formatPurchaseMoney(row.revenue),
						formatPurchaseMoney(row.profit),
					]),
			),
			{
				text: 'Rapor an\u0131ndaki stok ve ger\xE7ekle\u015Fen ortalama fiyatlar',
				fontSize: 13,
				bold: true,
				margin: [0, 18, 0, 8],
			},
			{
				text:
					'Stok g\xF6r\xFCnt\xFCleme zaman\u0131: ' +
					new Date(generatedAt).toLocaleString('tr-TR', {
						timeZone: 'Europe/Istanbul',
					}) +
					' (\u0130stanbul). Stok miktar\u0131 d\xF6nemden ba\u011F\u0131ms\u0131z g\xFCncel miktard\u0131r; se\xE7ili \xFCr\xFCn ve bayileri kapsar.',
				fontSize: 9,
				margin: [0, 0, 0, 8],
			},
			{
				text: 'Ortalama al\u0131\u015F = filtrelenen al\u0131\u015F tutar\u0131 / al\u0131\u015F miktar\u0131. Ortalama sat\u0131\u015F = se\xE7ili sat\u0131\u015F geliri / sat\u0131lan miktar. Ortalamalar miktarla a\u011F\u0131rl\u0131kland\u0131r\u0131l\u0131r; birimler ayr\u0131 tutulur. Br\xFCt k\xE2r, sat\u0131\u015F an\u0131nda kaydedilen maliyetlerden hesaplan\u0131r.',
				fontSize: 9,
				margin: [0, 0, 0, 8],
			},
			purchasePdfTable(
				[
					'\xDCr\xFCn',
					'Rapor an\u0131ndaki stok',
					'Ort. ger\xE7ekle\u015Fen al\u0131\u015F',
					'Ort. ger\xE7ekle\u015Fen sat\u0131\u015F',
					'Br\xFCt k\xE2r marj\u0131',
				],
				products.map((row) => [
					formatPurchaseProduct(row),
					formatPurchaseQuantity(row.currentQuantity, row.quantityUnit),
					row.averagePurchasePrice === null
						? '\u2014'
						: formatPurchaseMoney(row.averagePurchasePrice) +
							' / ' +
							(row.quantityUnit === 'piece' ? 'adet' : row.quantityUnit),
					row.averageSellingPrice === null
						? '\u2014'
						: formatPurchaseMoney(row.averageSellingPrice) +
							' / ' +
							(row.quantityUnit === 'piece' ? 'adet' : row.quantityUnit),
					row.margin === null
						? '\u2014'
						: row.margin.toLocaleString('tr-TR', { maximumFractionDigits: 2 }) +
							'%',
				]),
			),
			...((data.reportSales?.length ?? 0) > 0
				? [
						{
							text: 'Rapora dahil edilen sat\u0131\u015Flar',
							fontSize: 13,
							bold: true,
							margin: [0, 18, 0, 8],
						},
						...data.reportSales.flatMap((sale) => [
							{
								text:
									new Date(sale.createdAt).toLocaleString('tr-TR', {
										timeZone: 'Europe/Istanbul',
									}) +
									' \xB7 ' +
									sale.requestId,
								fontSize: 10,
								bold: true,
								margin: [0, 12, 0, 6],
							},
							purchasePdfTable(
								[
									'\xDCr\xFCn',
									'Kaynak bayi',
									'Sat\u0131lan miktar',
									'Sat\u0131\u015F geliri',
									'Sat\u0131lan mal maliyeti',
									'Br\xFCt k\xE2r',
								],
								[...sale.lines]
									.sort(
										(a, b) =>
											compareProductChoices(a, b) ||
											a.quantityUnit.localeCompare(b.quantityUnit),
									)
									.map((line) => [
										formatPurchaseProduct(line),
										(line.suppliers ?? [])
											.map((part) => {
												const name =
													supplierMap.get(
														part.bayiId ?? 'unlinked:' + part.bayiName,
													)?.name ?? part.bayiName;
												return (
													name +
													' (' +
													formatPurchaseQuantity(
														part.quantity,
														line.quantityUnit,
													) +
													')'
												);
											})
											.sort((a, b) => a.localeCompare(b, 'tr'))
											.join('\n') || '\u2014',
										formatPurchaseQuantity(line.quantity, line.quantityUnit),
										formatPurchaseMoney(line.revenue),
										formatPurchaseMoney(line.costOfGoods),
										formatPurchaseMoney(line.revenue - line.costOfGoods),
									]),
							),
						]),
					]
				: []),
			...(supplierGroups.length
				? [
						{
							text: 'Bayi bazl\u0131 sat\u0131\u015F k\xE2rl\u0131l\u0131\u011F\u0131',
							headlineLevel: 1,
							fontSize: 13,
							bold: true,
							margin: [0, 18, 0, 8],
						},
						...supplierGroups.flatMap((group) => [
							{
								text: 'Bayi: ' + group.name,
								fontSize: 12,
								bold: true,
								margin: [0, 12, 0, 6],
							},
							...datedRows(group).flatMap((day) => [
								...(day.date
									? [
											{
												text: /* @__PURE__ */ new Date(
													day.date + 'T12:00:00+03:00',
												).toLocaleDateString('tr-TR', {
													timeZone: 'Europe/Istanbul',
													dateStyle: 'long',
												}),
												fontSize: 10,
												bold: true,
												margin: [0, 8, 0, 4],
											},
										]
									: []),
								purchasePdfTable(
									[
										'\xDCr\xFCn',
										'Miktar',
										'Sat\u0131\u015F geliri',
										'Sat\u0131lan mal maliyeti',
										'Br\xFCt k\xE2r',
										'Marj',
									],
									[...day.rows]
										.sort(
											(a, b) =>
												compareProductChoices(a, b) ||
												a.quantityUnit.localeCompare(b.quantityUnit),
										)
										.map((row) => [
											formatPurchaseProduct(row) +
												(row.bayiName && group.name !== row.bayiName
													? '\n\u0130\u015Flem s\u0131ras\u0131nda bayi: ' +
														row.bayiName
													: ''),
											formatPurchaseQuantity(row.quantity, row.quantityUnit),
											formatPurchaseMoney(row.revenue),
											formatPurchaseMoney(row.costOfGoods),
											formatPurchaseMoney(row.profit),
											row.margin === null
												? '\u2014'
												: row.margin.toLocaleString('tr-TR', {
														maximumFractionDigits: 2,
													}) + '%',
										]),
								),
							]),
						]),
					]
				: []),
		],
		footer: (page, pages) => ({
			text: `${page} / ${pages}`,
			alignment: 'center',
			fontSize: 8,
		}),
	};
}
export { purchaseReportDocument, reportFilterSummary, stockSaleReportDocument };
