import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { Session } from '../../models/Session';
import {
	REFRESH_COOKIE_NAME,
	REFRESH_SECRET,
	cookieClaims,
	getProtected,
	getRefreshSetCookie,
	loginAndGetTokens,
	logout,
	refresh,
} from '../helpers';

describe('POST logout', () => {
	it('deletes the session, clears the cookie, and the refresh token stops working', async () => {
		const { cookie } = await loginAndGetTokens();

		const res = await logout(cookie);
		expect(res.status).toBe(204);
		expect(getRefreshSetCookie(res)).toMatch(/Expires=Thu, 01 Jan 1970/);
		expect(getRefreshSetCookie(res)).toMatch(/Path=\/auth\/session(;|$)/);
		expect(await Session.countDocuments()).toBe(0);

		const after = await refresh(cookie);
		expect(after.status).toBe(401);
		expect(after.body.message).toMatch(/Session has been revoked/i);
	});

	it('only ends the current session', async () => {
		const { cookie: deviceA } = await loginAndGetTokens();
		const { cookie: deviceB } = await loginAndGetTokens();
		await logout(deviceA);
		expect((await refresh(deviceB)).status).toBe(200);
	});

	it('still revokes the session when the refresh token has expired', async () => {
		await loginAndGetTokens();
		const session = await Session.findOne().lean();
		const expired = jwt.sign(
			{
				userId: 'x',
				email: 'x',
				sid: session!._id,
				jti: session!.currentJti,
				exp: Math.floor(Date.now() / 1000) - 10,
			},
			REFRESH_SECRET,
		);
		expect((await logout(`${REFRESH_COOKIE_NAME}=${expired}`)).status).toBe(204);
		expect(await Session.countDocuments()).toBe(0);
	});

	it('no cookie - 204 (nothing to log out of)', async () => {
		expect((await logout()).status).toBe(204);
	});

	it('forged cookie - 204 and no session is touched', async () => {
		const { cookie } = await loginAndGetTokens();
		const forged = jwt.sign({ ...cookieClaims(cookie) }, 'wrong-secret');
		expect((await logout(`${REFRESH_COOKIE_NAME}=${forged}`)).status).toBe(204);
		expect(await Session.countDocuments()).toBe(1);
	});

	it('known limitation: an access token keeps working until it expires', async () => {
		const { accessToken, cookie } = await loginAndGetTokens();
		await logout(cookie);
		expect((await getProtected(accessToken)).status).toBe(200);
	});
});
