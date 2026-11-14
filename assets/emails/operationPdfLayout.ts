import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';

// Match the existing purchase PDF layout without importing browser code into the server.
export const OPERATION_PDF_PAGE = {
	pageSize: 'A4' as const,
	pageMargins: [32, 40, 32, 44] as [number, number, number, number],
	defaultStyle: { font: 'Roboto', fontSize: 9, lineHeight: 1.15 },
	footer: ((page: number, pages: number) => ({
		text: `${page} / ${pages}`,
		alignment: 'center',
		fontSize: 8,
	})) as TDocumentDefinitions['footer'],
};
export function operationPdfTable(
	headers: string[],
	rows: string[][],
): Content {
	const wrap = (text: string) =>
		text.replace(/[\u00a0\u202f]/g, ' ').replace(/[^\s\u200b]{13,}/gu, (word) =>
			Array.from(word)
				.map((char, i) => (i > 0 && i % 12 === 0 ? '\u200b' : '') + char)
				.join(''),
		);
	const width = (595.28 - 32 - 32 - 2 - headers.length * 8) / headers.length;
	return {
		fontSize: headers.length >= 6 ? 8 : 9,
		table: {
			headerRows: 1,
			dontBreakRows: false,
			keepWithHeaderRows: 0,
			widths: headers.map(() => width),
			body: [
				headers.map((text) => ({
					text: wrap(text),
					bold: true,
					fillColor: '#eeeeee',
				})),
				...rows.map((row) => row.map((text) => ({ text: wrap(text) }))),
			],
		},
		layout: {
			hLineWidth: () => 0.5,
			vLineWidth: () => 0,
			hLineColor: () => '#dddddd',
			paddingLeft: () => 4,
			paddingRight: () => 4,
			paddingTop: () => 5,
			paddingBottom: () => 5,
		},
	};
}
