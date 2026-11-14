import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(
	new URL(
		'../../frontend/src/app/helpers/analysisReportDocuments.entry.ts',
		import.meta.url,
	),
);
const output = fileURLToPath(
	new URL('../assets/reports/analysisDocuments.generated.mjs', import.meta.url),
);
if (!existsSync(entry)) {
	if (!existsSync(output))
		throw new Error(
			'Analiz PDF builders are missing. Run sync:report-pdf in the workspace before deploying.',
		);
	console.log(
		'Using the checked-in Analiz PDF bundle; frontend sources are not present.',
	);
} else {
	await build({
		entryPoints: [entry],
		outfile: output,
		bundle: true,
		platform: 'node',
		format: 'esm',
		target: 'node22',
		treeShaking: true,
		banner: {
			js: '// Generated from the frontend Analiz PDF builders. Do not edit. Run npm run sync:report-pdf in server.',
		},
	});
	console.log(
		'Synced the existing Analiz PDF builders for server-side email attachments.',
	);
}
