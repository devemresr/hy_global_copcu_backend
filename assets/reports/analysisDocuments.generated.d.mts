import type { TDocumentDefinitions } from 'pdfmake/interfaces';
export function purchaseReportDocument(
	data: unknown,
	filters: unknown,
	charts: unknown[],
): TDocumentDefinitions;
export function stockSaleReportDocument(
	data: unknown,
	filters: unknown,
): TDocumentDefinitions;
export function reportFilterSummary(
	filters: object,
	names?: {
		bayiName?: string | null;
		investorName?: string | null;
		categoryName?: string | null;
	},
): string[];
