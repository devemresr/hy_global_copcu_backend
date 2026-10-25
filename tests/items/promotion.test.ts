import { beforeEach, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../app';
import { User } from '../../models/User';
import { AppState, APP_STATE_ID } from '../../models/AppState';
import { LogEvent } from '../../models/LogEvent';
import { initVersionState } from '../../services/sync/version.service';
import { loginAndGetTokens, TEST_USER } from '../helpers';

const settings = { enabled: true, showEveryVisit: true, brandLabel: 'Yeni marka', title: 'Yeni kampanya', tagline: 'Tanıtım', description: 'Kampanya detayları' };
beforeEach(() => initVersionState());

it('restricts promotion changes to head admins and validates content', async () => {
	expect((await request(app).put('/site/promotion').send(settings)).status).toBe(401);
	const { accessToken } = await loginAndGetTokens();
	const save = (body: object) => request(app).put('/site/promotion').set('Authorization', `Bearer ${accessToken}`).send(body);
	expect((await save(settings)).status).toBe(403);
	await User.updateOne({ email: TEST_USER.email }, { $set: { role: 'head_admin' } });
	expect((await save({ ...settings, title: 'x'.repeat(161) })).status).toBe(400);
	expect((await save({ ...settings, brandLabel: 'x'.repeat(121) })).status).toBe(400);
	expect((await save({ ...settings, showEveryVisit: 'true' })).status).toBe(400);
	expect((await AppState.findById(APP_STATE_ID).lean())?.promotion.showEveryVisit).toBe(false);
});

it('persists promotion content across restarts, changes the public ETag, and audits edits', async () => {
	await User.updateOne({ email: TEST_USER.email }, { $set: { role: 'head_admin' } });
	const { accessToken } = await loginAndGetTokens();
	const before = await request(app).get('/site/status');
	const response = await request(app).put('/site/promotion').set('Authorization', `Bearer ${accessToken}`).send(settings);
	expect(response.status).toBe(200);
	expect(response.body.promotion).toEqual(settings);
	expect((await AppState.findById(APP_STATE_ID).lean())?.promotion).toEqual(settings);
	await initVersionState();
	const after = await request(app).get('/site/status').set('If-None-Match', before.headers.etag!);
	expect(after.status).toBe(200);
	expect(after.headers.etag).not.toBe(before.headers.etag);
	expect(after.body.promotion).toEqual(settings);
	expect(await LogEvent.countDocuments({ action: 'site:promotion_update' })).toBe(1);
});
