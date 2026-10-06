import { expect } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import * as bcrypt from 'bcryptjs';
import app from '../app';
import { User } from '../models/User';
import { AUTH_ROUTES, LOG_EVENTS_ROUTES } from '../routes/routes.constant';

export const REFRESH_COOKIE_NAME = 'jwt';
export const REFRESH_SECRET = process.env.REFRESH_TOKEN_SECRET!;

/** Waits that guarantee a token of the mocked lifetime (setup.ts) has expired. */
export const TIMING = {
	ACCESS_EXPIRED_MS: 1_100,
	REFRESH_EXPIRED_MS: 3_100,
	PAST_GRACE_MS: 600,
};

export const TEST_USER = {
	email: 'admin@test.com',
	password: 'Password123!',
	username: 'admin',
};

export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const seedUser = async (user = TEST_USER) =>
	User.create({ ...user, password: await bcrypt.hash(user.password, 4) });

/** supertest returns set-cookie as string | string[] | undefined - normalize it. */
const getCookies = (res: request.Response): string[] => {
	const raw = res.headers['set-cookie'] as string | string[] | undefined;
	return Array.isArray(raw) ? raw : raw ? [raw] : [];
};

/** Full Set-Cookie line for the refresh cookie, or '' if the response set none. */
export const getRefreshSetCookie = (res: request.Response) =>
	getCookies(res).find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`)) ?? '';

/** Just `jwt=<token>` - what a browser would send back. */
export const toCookieHeader = (setCookie: string) => setCookie.split(';')[0]!;

export const cookieClaims = (cookie: string) =>
	jwt.decode(cookie.split('=')[1]!) as { sid: string; jti: string; userId: string; email: string };

export const login = (body: object = TEST_USER) =>
	request(app).post(AUTH_ROUTES.LOGIN).send(body);

export async function loginAndGetTokens() {
	const res = await login();
	expect(res.status).toBe(200);
	return {
		res,
		accessToken: res.body.accessToken as string,
		cookie: toCookieHeader(getRefreshSetCookie(res)),
	};
}

export const refresh = (cookie?: string) => {
	const req = request(app).post(AUTH_ROUTES.REFRESH);
	return cookie ? req.set('Cookie', cookie) : req;
};

/** Refreshes and returns the rotated cookie, asserting success. */
export async function refreshAndGetCookie(cookie: string) {
	const res = await refresh(cookie);
	expect(res.status).toBe(200);
	return toCookieHeader(getRefreshSetCookie(res));
}

export const logout = (cookie?: string) => {
	const req = request(app).post(AUTH_ROUTES.LOGOUT);
	return cookie ? req.set('Cookie', cookie) : req;
};

/** GET on a requireAuth route, for access-token checks. */
export const getProtected = (accessToken?: string) => {
	const req = request(app).get(LOG_EVENTS_ROUTES.LIST);
	return accessToken ? req.set('Authorization', `Bearer ${accessToken}`) : req;
};
