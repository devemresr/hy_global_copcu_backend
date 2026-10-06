import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { TIMING, getProtected, loginAndGetTokens, wait } from '../helpers';

describe('requireAuth - access token on a protected route', () => {
	it('valid access token - passes through', async () => {
		const { accessToken } = await loginAndGetTokens();
		const res = await getProtected(accessToken);
		expect(res.status).toBe(200);
	});

	it('no token - 401', async () => {
		const res = await getProtected();
		expect(res.status).toBe(401);
	});

	it('expired access token - 401 asking for a refresh', async () => {
		const { accessToken } = await loginAndGetTokens();
		await wait(TIMING.ACCESS_EXPIRED_MS);
		const res = await getProtected(accessToken);
		expect(res.status).toBe(401);
		expect(res.body.message).toMatch(/Access token expired/i);
	});

	it('malformed access token - 401 invalid', async () => {
		const res = await getProtected('this.is.malformedToken');
		expect(res.status).toBe(401);
		expect(res.body.message).toMatch(/Invalid access token/i);
	});

	it('token signed with the wrong secret - 401 invalid', async () => {
		const forged = jwt.sign(
			{ userId: new mongoose.Types.ObjectId().toString(), email: 'x', jti: 'x' },
			'wrong-secret',
		);
		const res = await getProtected(forged);
		expect(res.status).toBe(401);
		expect(res.body.message).toMatch(/Invalid access token/i);
	});

	it('unsigned (alg: none) token - 401 invalid', async () => {
		const unsigned = jwt.sign({ userId: 'x', email: 'x', jti: 'x' }, '', { algorithm: 'none' });
		const res = await getProtected(unsigned);
		expect(res.status).toBe(401);
		expect(res.body.message).toMatch(/Invalid access token/i);
	});

	it('refresh token used as a Bearer token - 401 invalid', async () => {
		const { cookie } = await loginAndGetTokens();
		const res = await getProtected(cookie.split('=')[1]);
		expect(res.status).toBe(401);
		expect(res.body.message).toMatch(/Invalid access token/i);
	});
});
