import { beforeEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../../app';
import { User } from '../../models/User';
import { loginAndGetTokens, TEST_USER } from '../helpers';

const smtp = vi.hoisted(() => ({
	sendMail: vi.fn(),
	close: vi.fn(),
	createTransport: vi.fn(),
}));
vi.mock('nodemailer', () => ({
	default: { createTransport: smtp.createTransport },
}));
vi.mock('../../config/env', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../config/env')>();
	return {
		...actual,
		default: {
			...actual.default,
			SMTP_HOST: 'smtp.example.test',
			SMTP_PORT: 465,
			SMTP_SECURE: true,
			SMTP_USER: 'sender@example.test',
			SMTP_PASSWORD: 'mock-secret',
			SMTP_FROM: 'sender@example.test',
		},
	};
});
beforeEach(() => {
	smtp.createTransport
		.mockReset()
		.mockReturnValue({ sendMail: smtp.sendMail, close: smtp.close });
	smtp.sendMail
		.mockReset()
		.mockResolvedValue({ accepted: ['recipient@example.test'], rejected: [] });
	smtp.close.mockReset();
});
async function authorized() {
	await User.updateOne(
		{ email: TEST_USER.email },
		{ $set: { role: 'head_admin' } },
	);
	return (await loginAndGetTokens()).accessToken;
}
function send(token: string, body: object) {
	return request(app)
		.post('/admins/test-email')
		.set('Authorization', `Bearer ${token}`)
		.send(body);
}
it('requires authentication and a head admin before sending', async () => {
	await request(app)
		.post('/admins/test-email')
		.send({ to: 'recipient@example.test' })
		.expect(401);
	const { accessToken } = await loginAndGetTokens();
	await send(accessToken, { to: 'recipient@example.test' }).expect(403);
	expect(smtp.sendMail).not.toHaveBeenCalled();
});
it('rejects invalid addresses, multiple recipients and custom message content', async () => {
	const token = await authorized();
	for (const to of [
		'',
		'not-an-email',
		'a@example.test,b@example.test',
		'a@example.test\r\nBcc: other@example.test',
	])
		await send(token, { to }).expect(400);
	await send(token, { to: 'recipient@example.test', subject: 'Custom' }).expect(
		400,
	);
	expect(smtp.sendMail).not.toHaveBeenCalled();
});
it('sends the fixed test email with server-side credentials and a normalized recipient', async () => {
	const response = await send(await authorized(), {
		to: ' Recipient@Example.test ',
	}).expect(200);
	expect(response.body).toEqual({ success: true });
	expect(smtp.createTransport).toHaveBeenCalledWith(
		expect.objectContaining({
			host: 'smtp.example.test',
			secure: true,
			logger: false,
			auth: { user: 'sender@example.test', pass: 'mock-secret' },
		}),
	);
	expect(smtp.sendMail).toHaveBeenCalledWith(
		expect.objectContaining({
			to: 'recipient@example.test',
			from: 'sender@example.test',
			subject: 'HY Global Çöpçü · Test e-postası',
			text: expect.stringContaining('yönetim panelinden'),
			html: expect.stringContaining('lang="tr"'),
		}),
	);
	expect(JSON.stringify(response.body)).not.toContain('mock-secret');
	expect(smtp.close).toHaveBeenCalledOnce();
});
it('returns a safe error and closes the transport on SMTP failures', async () => {
	smtp.sendMail.mockRejectedValue(new Error('provider detail mock-secret'));
	const response = await send(await authorized(), {
		to: 'recipient@example.test',
	}).expect(502);
	expect(response.body.message).toContain('Test e-postası gönderilemedi');
	expect(JSON.stringify(response.body)).not.toContain('mock-secret');
	expect(smtp.close).toHaveBeenCalledOnce();
});
it('does not report success for rejected recipients', async () => {
	smtp.sendMail.mockResolvedValue({
		accepted: [],
		rejected: ['recipient@example.test'],
	});
	await send(await authorized(), { to: 'recipient@example.test' }).expect(502);
	expect(smtp.close).toHaveBeenCalledOnce();
});
