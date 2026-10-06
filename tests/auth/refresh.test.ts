import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { User } from '../../models/User';
import { Session } from '../../models/Session';
import {
	REFRESH_COOKIE_NAME,
	REFRESH_SECRET,
	TIMING,
	cookieClaims,
	getProtected,
	getRefreshSetCookie,
	loginAndGetTokens,
	refresh,
	refreshAndGetCookie,
	toCookieHeader,
	wait,
} from '../helpers';

describe('POST refresh', () => {
	it('issues a new access token and rotates the refresh cookie', async () => {
		const { accessToken, cookie } = await loginAndGetTokens();
		await wait(TIMING.ACCESS_EXPIRED_MS);

		const res = await refresh(cookie);
		const rotated = toCookieHeader(getRefreshSetCookie(res));

		expect(res.status).toBe(200);
		expect(res.body.accessToken).toBeDefined();
		expect(res.body.accessToken).not.toBe(accessToken);
		expect(res.body.user.password).toBeUndefined();
		expect(cookieClaims(rotated).jti).not.toBe(cookieClaims(cookie).jti);
		expect(cookieClaims(rotated).sid).toBe(cookieClaims(cookie).sid);

		expect((await getProtected(res.body.accessToken)).status).toBe(200);
	});

	it('no refresh cookie - 401', async () => {
		const res = await refresh();
		expect(res.status).toBe(401);
		expect(res.body.message).toMatch(/No refresh token provided/i);
	});

	it('expired refresh token - 401, must re-login', async () => {
		const { cookie } = await loginAndGetTokens();
		await wait(TIMING.REFRESH_EXPIRED_MS);
		const res = await refresh(cookie);
		expect(res.status).toBe(401);
		expect(res.body.message).toMatch(/Refresh token expired/i);
	});

	it('sliding expiry - an active session outlives the first refresh token', async () => {
		const { cookie: original } = await loginAndGetTokens();
		await wait(1_500);
		const rotated = await refreshAndGetCookie(original);
		await wait(1_600); // original has now expired, rotated has not

		expect(cookieClaims(original).jti).not.toBe(cookieClaims(rotated).jti);
		expect((await refresh(rotated)).status).toBe(200);
	});

	it('malformed refresh cookie - 401 and cookie cleared', async () => {
		const res = await refresh(`${REFRESH_COOKIE_NAME}=garbage`);
		expect(res.status).toBe(401);
		expect(res.body.message).toMatch(/Invalid refresh token/i);
		expect(getRefreshSetCookie(res)).toMatch(/Expires=Thu, 01 Jan 1970/);
	});

	it('access token used as the refresh cookie - 401', async () => {
		const { accessToken } = await loginAndGetTokens();
		const res = await refresh(`${REFRESH_COOKIE_NAME}=${accessToken}`);
		expect(res.status).toBe(401);
	});

	it('validly signed token without sid (pre-rotation format) - 401', async () => {
		const legacy = jwt.sign({ userId: 'x', email: 'x', jti: 'x' }, REFRESH_SECRET, { expiresIn: 60 });
		const res = await refresh(`${REFRESH_COOKIE_NAME}=${legacy}`);
		expect(res.status).toBe(401);
		expect(res.body.message).toMatch(/Invalid refresh token/i);
	});

	it('user deleted after login - 401 invalid session', async () => {
		const { cookie } = await loginAndGetTokens();
		await User.deleteMany({});
		const res = await refresh(cookie);
		expect(res.status).toBe(401);
		expect(res.body.message).toMatch(/Invalid session/i);
	});

	it('session past its absolute cap - 401 even with a live refresh token', async () => {
		const { cookie } = await loginAndGetTokens();
		await Session.updateMany({}, { expiresAt: new Date(Date.now() - 1_000) });
		const res = await refresh(cookie);
		expect(res.status).toBe(401);
		expect(res.body.message).toMatch(/Session has been revoked/i);
	});

	it('rotated cookie lifetime is capped by the session absolute expiry', async () => {
		const { cookie } = await loginAndGetTokens();
		await Session.updateMany({}, { expiresAt: new Date(Date.now() + 2_500) });
		const res = await refresh(cookie);
		expect(res.status).toBe(200);
		const maxAge = Number(/Max-Age=(\d+)/.exec(getRefreshSetCookie(res))?.[1]);
		expect(maxAge).toBeLessThanOrEqual(2);
	});
});
