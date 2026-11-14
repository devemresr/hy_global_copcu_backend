import nodemailer from 'nodemailer';
import type { SendMailOptions } from 'nodemailer';
import env from '../../config/env';
import { HttpError } from '../../errors/HttpError';
import { testEmail } from '../../assets/emails/testEmail';
import logger from '../../util/logger';

// Adapted from infopfa's shared SMTP sender; credentials stay in server env files.
export async function sendEmail(
	message: Pick<
		SendMailOptions,
		'to' | 'subject' | 'html' | 'text' | 'attachments' | 'messageId'
	>,
): Promise<void> {
	if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD || !env.SMTP_FROM)
		throw new HttpError(
			'SMTP is not configured',
			503,
			'E-posta gönderimi henüz yapılandırılmadı.',
		);
	const transport = nodemailer.createTransport({
		host: env.SMTP_HOST,
		port: env.SMTP_PORT,
		secure: env.SMTP_SECURE,
		requireTLS: !env.SMTP_SECURE,
		auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
		connectionTimeout: 10_000,
		greetingTimeout: 10_000,
		socketTimeout: 15_000,
		logger: false,
		debug: false,
	});
	try {
		const result = await transport.sendMail({
			from: env.SMTP_FROM,
			...message,
		});
		if (result.rejected.length || !result.accepted.length)
			throw new Error('SMTP recipient rejected');
	} catch (error) {
		// Log protocol codes, never provider messages, addresses or credentials.
		const smtp = error as {
			code?: unknown;
			command?: unknown;
			responseCode?: unknown;
		} | null;
		const codes = [
			'EAUTH',
			'ECONNECTION',
			'ESOCKET',
			'ETIMEDOUT',
			'EDNS',
			'ETLS',
			'EENVELOPE',
			'EMESSAGE',
		];
		const commands = [
			'CONN',
			'EHLO',
			'HELO',
			'STARTTLS',
			'AUTH PLAIN',
			'AUTH LOGIN',
			'MAIL FROM',
			'RCPT TO',
			'DATA',
		];
		logger.warn(
			{
				module: 'emailSender',
				code:
					typeof smtp?.code === 'string' && codes.includes(smtp.code)
						? smtp.code
						: 'UNKNOWN',
				command:
					typeof smtp?.command === 'string' && commands.includes(smtp.command)
						? smtp.command
						: undefined,
				responseCode:
					typeof smtp?.responseCode === 'number'
						? smtp.responseCode
						: undefined,
			},
			'SMTP delivery failed',
		);
		throw new HttpError(
			'Email delivery failed',
			502,
			'Test e-postası gönderilemedi. E-posta sunucusu ayarlarını kontrol edin.',
		);
	} finally {
		transport.close();
	}
}

export async function sendTestEmail(to: string): Promise<void> {
	await sendEmail({ to, ...testEmail() });
}
