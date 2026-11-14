export function testEmail(sentAt = new Date()) {
	const date = sentAt.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
	const subject = 'HY Global Çöpçü · Test e-postası';
	const text = `HY Global Çöpçü\n\nBu test e-postası yönetim panelinden gönderildi.\nGönderim zamanı: ${date} (İstanbul)\n\nBu ileti bir alış veya satış kaydı oluşturmaz.`;
	return {
		subject,
		text,
		html: `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a">
<table role="presentation" style="width:100%;border-collapse:collapse"><tr><td style="padding:24px 12px">
<table role="presentation" style="width:100%;max-width:600px;margin:auto;border-collapse:collapse;background:white">
<tr><td style="padding:24px;background:#0f172a;color:white;font-size:22px;font-weight:bold">HY Global Çöpçü</td></tr>
<tr><td style="padding:24px"><h1 style="font-size:20px">Test e-postası</h1><p>Bu test e-postası yönetim panelinden gönderildi.</p><p>Gönderim zamanı: ${date} (İstanbul)</p><p style="font-size:13px;color:#475569">Bu ileti bir alış veya satış kaydı oluşturmaz.</p></td></tr>
</table></td></tr></table></body></html>`,
	};
}
