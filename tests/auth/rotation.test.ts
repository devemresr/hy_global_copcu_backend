import { describe, expect, it } from 'vitest';
import { Session } from '../../models/Session';
import {
	TIMING,
	getRefreshSetCookie,
	loginAndGetTokens,
	refresh,
	refreshAndGetCookie,
	toCookieHeader,
	wait,
} from '../helpers';

describe('refresh token rotation - reuse detection and grace window', () => {
	it('replaying an old refresh token past the grace window revokes the whole session', async () => {
		const { cookie: stolen } = await loginAndGetTokens();
		const current = await refreshAndGetCookie(stolen);
		await wait(TIMING.PAST_GRACE_MS);

		const replay = await refresh(stolen);
		expect(replay.status).toBe(401);
		expect(replay.body.message).toMatch(/Session has been revoked/i);
		expect(await Session.countDocuments()).toBe(0);

		// The legitimate holder is logged out too.
		expect((await refresh(current)).status).toBe(401);
	});

	it('two tabs refreshing with the same cookie at once both succeed', async () => {
		const { cookie } = await loginAndGetTokens();
		const [a, b] = await Promise.all([refresh(cookie), refresh(cookie)]);
		expect(a.status).toBe(200);
		expect(b.status).toBe(200);
		expect(await Session.countDocuments()).toBe(1);
	});

	it('a lost refresh response can be retried inside the grace window and the session survives', async () => {
		const { cookie } = await loginAndGetTokens();
		await refreshAndGetCookie(cookie); // response "lost" - browser keeps the old cookie

		const retry = await refresh(cookie);
		expect(retry.status).toBe(200);
		const reissued = toCookieHeader(getRefreshSetCookie(retry));
		expect(reissued).not.toBe('');

		// The re-issued cookie must keep working after the grace window closes.
		await wait(TIMING.PAST_GRACE_MS);
		expect((await refresh(reissued)).status).toBe(200);
	});

	it('only the replayed session is revoked, not the user’s other sessions', async () => {
		const { cookie: deviceA } = await loginAndGetTokens();
		const { cookie: deviceB } = await loginAndGetTokens();
		await refreshAndGetCookie(deviceA);
		await wait(TIMING.PAST_GRACE_MS);

		expect((await refresh(deviceA)).status).toBe(401);
		expect((await refresh(deviceB)).status).toBe(200);
	});
});
