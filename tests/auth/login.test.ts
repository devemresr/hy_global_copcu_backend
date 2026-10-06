import { describe, expect, it } from 'vitest';
import { Session } from '../../models/Session';
import {
	TEST_USER,
	getRefreshSetCookie,
	login,
	loginAndGetTokens,
} from '../helpers';

// Admins are seeded (setup.ts) - this app has no register route.
describe('POST login', () => {
	it('returns an access token, the user without password, and an HttpOnly refresh cookie', async () => {
		const { res, accessToken } = await loginAndGetTokens();
		const setCookie = getRefreshSetCookie(res);

		expect(accessToken).toBeDefined();
		expect(res.body.user.email).toBe(TEST_USER.email);
		expect(res.body.user.password).toBeUndefined();
		expect(setCookie).toMatch(/HttpOnly/i);
		expect(setCookie).toMatch(/Path=\/auth\/session(;|$)/);
		expect(setCookie).toMatch(/SameSite=Lax/i);
	});

	it('creates one server-side session per login', async () => {
		await loginAndGetTokens();
		await loginAndGetTokens();
		expect(await Session.countDocuments()).toBe(2);
	});

	it('normalizes email case and whitespace', async () => {
		const res = await login({ ...TEST_USER, email: '  ADMIN@Test.com ' });
		expect(res.status).toBe(200);
	});

	it('rejects a wrong password with 401', async () => {
		const res = await login({ email: TEST_USER.email, password: 'wrongpassword' });
		expect(res.status).toBe(401);
		expect(getRefreshSetCookie(res)).toBe('');
	});

	it('answers an unknown email exactly like a wrong password', async () => {
		const wrongPassword = await login({ email: TEST_USER.email, password: 'nope' });
		const unknownUser = await login({ email: 'ghost@test.com', password: 'nope' });
		expect(unknownUser.status).toBe(401);
		expect(unknownUser.body).toEqual(wrongPassword.body);
	});

	it('rejects an invalid body with 400', async () => {
		const res = await login({ email: 'not-an-email', password: '' });
		expect(res.status).toBe(400);
	});
});
