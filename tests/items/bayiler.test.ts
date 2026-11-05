import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../app';
import { Bayi } from '../../models/Bayi';
import { BAYI_ROUTES } from '../../routes/routes.constant';
import { loginAndGetTokens } from '../helpers';
import {
	normalizeBayiName,
	normalizeBayiPhone,
} from '../../schemas/bayi.schema';

beforeEach(async () => {
	await Bayi.createIndexes();
});
const input = { name: 'Örnek Bayi', phone: '0555 123 45 67' };
describe('bayiler', () => {
	it('normalizes Turkish names and common phone formats', () => {
		expect(normalizeBayiName('  ÖRNEK  BAYİ ')).toBe('örnek bayi');
		for (const value of [
			'0555 123 45 67',
			'5551234567',
			'+90 (555) 123-45-67',
			'00905551234567',
			'+90 0555 1234567',
		])
			expect(normalizeBayiPhone(value)).toBe('+905551234567');
		expect(normalizeBayiPhone('not a phone')).toBe('');
		for (const value of [
			'12345678901234567890',
			'12345678901234567',
			'01111111111',
		])
			expect(normalizeBayiPhone(value)).toBe('');
		expect(normalizeBayiPhone('+1 202 555 0123')).toBe('+12025550123');
	});
	it('requires authentication for listing, adding and editing', async () => {
		expect((await request(app).get(BAYI_ROUTES.LIST)).status).toBe(401);
		expect(
			(await request(app).post(BAYI_ROUTES.CREATE).send(input)).status,
		).toBe(401);
		expect(
			(
				await request(app)
					.patch(BAYI_ROUTES.UPDATE.replace(':id', '000000000000000000000001'))
					.send(input)
			).status,
		).toBe(401);
	});
	it('requires both fields and returns only public, editable contact details', async () => {
		const { accessToken } = await loginAndGetTokens();
		const auth = `Bearer ${accessToken}`;
		for (const invalid of [
			{ name: 'Bayi' },
			{ phone: input.phone },
			{ name: '', phone: input.phone },
			{ name: 'Bayi', phone: 'abc123' },
		])
			expect(
				(
					await request(app)
						.post(BAYI_ROUTES.CREATE)
						.set('Authorization', auth)
						.send(invalid)
				).status,
			).toBe(400);
		const created = await request(app)
			.post(BAYI_ROUTES.CREATE)
			.set('Authorization', auth)
			.send(input);
		expect(created.status, JSON.stringify(created.body)).toBe(201);
		expect(created.body.bayi).toEqual({
			_id: expect.any(String),
			name: input.name,
			phone: '+905551234567',
		});
		const edited = await request(app)
			.patch(BAYI_ROUTES.UPDATE.replace(':id', created.body.bayi._id))
			.set('Authorization', auth)
			.send({ name: 'Yeni bayi adı', phone: '05559876543' });
		expect(edited.status).toBe(200);
		expect(edited.body.bayi).toMatchObject({
			name: 'Yeni bayi adı',
			phone: '+905559876543',
		});
		const listed = await request(app)
			.get(BAYI_ROUTES.LIST)
			.set('Authorization', auth);
		expect(listed.body.bayiler).toEqual([edited.body.bayi]);
	});
	it('returns the matching record on duplicate names or formatted phone numbers', async () => {
		const { accessToken } = await loginAndGetTokens();
		const auth = `Bearer ${accessToken}`;
		const first = await request(app)
			.post(BAYI_ROUTES.CREATE)
			.set('Authorization', auth)
			.send(input);
		for (const duplicate of [
			{ name: '  ÖRNEK  BAYİ  ', phone: '05551111111' },
			{ name: 'Başka ad', phone: '+90 (555) 123-45-67' },
		]) {
			const result = await request(app)
				.post(BAYI_ROUTES.CREATE)
				.set('Authorization', auth)
				.send(duplicate);
			expect(result.status).toBe(409);
			expect(result.body.details.selectedBayiId).toBe(first.body.bayi._id);
			expect(result.body.details.matches[0].bayi).toEqual(first.body.bayi);
			expect(result.body.message).toContain('Örnek Bayi');
		}
		expect(await Bayi.countDocuments()).toBe(1);
	});
	it('identifies both entries when the name and phone match different bayiler and preserves edits on conflict', async () => {
		const { accessToken } = await loginAndGetTokens();
		const auth = `Bearer ${accessToken}`;
		const first = await request(app)
			.post(BAYI_ROUTES.CREATE)
			.set('Authorization', auth)
			.send(input);
		const second = await request(app)
			.post(BAYI_ROUTES.CREATE)
			.set('Authorization', auth)
			.send({ name: 'İkinci bayi', phone: '05551111111' });
		const conflict = await request(app)
			.post(BAYI_ROUTES.CREATE)
			.set('Authorization', auth)
			.send({ name: input.name, phone: '05551111111' });
		expect(conflict.status).toBe(409);
		expect(conflict.body.details.matches).toHaveLength(2);
		expect(conflict.body.details.selectedBayiId).toBe(first.body.bayi._id);
		const unchanged = await request(app)
			.patch(BAYI_ROUTES.UPDATE.replace(':id', first.body.bayi._id))
			.set('Authorization', auth)
			.send(input);
		expect(unchanged.status).toBe(200);
		const edit = await request(app)
			.patch(BAYI_ROUTES.UPDATE.replace(':id', first.body.bayi._id))
			.set('Authorization', auth)
			.send({ name: input.name, phone: second.body.bayi.phone });
		expect(edit.status).toBe(409);
		expect((await Bayi.findById(first.body.bayi._id).lean())?.phone).toBe(
			'+905551234567',
		);
	});
	it('allows only one matching entry when requests race', async () => {
		const { accessToken } = await loginAndGetTokens();
		const results = await Promise.all(
			[1, 2].map(() =>
				request(app)
					.post(BAYI_ROUTES.CREATE)
					.set('Authorization', `Bearer ${accessToken}`)
					.send(input),
			),
		);
		expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
		expect(await Bayi.countDocuments()).toBe(1);
		expect(
			results.find((result) => result.status === 409)!.body.details
				.selectedBayiId,
		).toBe(results.find((result) => result.status === 201)!.body.bayi._id);
	});
});
