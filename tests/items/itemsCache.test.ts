import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../../app';
import { Item } from '../../models/Item';
import { User } from '../../models/User';
import { PERMISSIONS } from '../../constants/permissions.constant';
import { ITEMS_ROUTES } from '../../routes/routes.constant';
import { createCachedFetcher } from '../../util/queryCache';
import { loginAndGetTokens, TEST_USER } from '../helpers';

afterEach(() => vi.restoreAllMocks());

describe('item list caching', () => {
	let auth: string;
	let itemId: string;
	beforeEach(async () => {
		await User.updateOne({ email: TEST_USER.email }, { $set: { permissions: [PERMISSIONS.ITEMS_CREATE, PERMISSIONS.ITEMS_UPDATE, PERMISSIONS.ITEMS_DELETE] } });
		auth = `Bearer ${(await loginAndGetTokens()).accessToken}`;
		// API creation also invalidates any list cached by the previous test.
		const created = await request(app).post(ITEMS_ROUTES.CREATE).set('Authorization', auth).send({ model: 'ORIGINAL', fiyat: 100 });
		expect(created.status).toBe(201);
		itemId = created.body.item._id;
	});

	it('reuses a populated list without querying the database again', async () => {
		const find = vi.spyOn(Item, 'find');
		const first = await request(app).get(ITEMS_ROUTES.LIST);
		const second = await request(app).get(ITEMS_ROUTES.LIST);
		expect(first.status).toBe(200);
		expect(first.body.items).toEqual([expect.objectContaining({ _id: itemId, model: 'ORIGINAL', fiyat: 100 })]);
		expect(second.status).toBe(200);
		expect(second.body).toEqual(first.body);
		expect(second.headers.etag).toBe(first.headers.etag);
		expect(find).toHaveBeenCalledTimes(1);
	});

	it('serves concurrent reads with one database query', async () => {
		const find = vi.spyOn(Item, 'find');
		const responses = await Promise.all(Array.from({ length: 8 }, () => request(app).get(ITEMS_ROUTES.LIST)));
		for (const response of responses) {
			expect(response.status).toBe(200);
			expect(response.body).toEqual(responses[0].body);
		}
		expect(find).toHaveBeenCalledTimes(1);
	});

	it('returns 304 with no body for a matching ETag and 200 for a stale ETag', async () => {
		const find = vi.spyOn(Item, 'find');
		const first = await request(app).get(ITEMS_ROUTES.LIST);
		expect(first.headers.etag).toBeTruthy();
		expect(first.headers['cache-control']).toBe('no-cache');
		const fresh = await request(app).get(ITEMS_ROUTES.LIST).set('If-None-Match', first.headers.etag);
		expect(fresh.status).toBe(304);
		expect(fresh.text).toBe('');
		expect(fresh.headers.etag).toBe(first.headers.etag);
		const stale = await request(app).get(ITEMS_ROUTES.LIST).set('If-None-Match', '"outdated-items"');
		expect(stale.status).toBe(200);
		expect(stale.body).toEqual(first.body);
		expect(find).toHaveBeenCalledTimes(1);
	});

	it('refreshes after five minutes while preserving the ETag for unchanged data', async () => {
		let now = Date.now();
		vi.spyOn(Date, 'now').mockImplementation(() => now);
		const find = vi.spyOn(Item, 'find');
		const first = await request(app).get(ITEMS_ROUTES.LIST);
		now += 5 * 60 * 1000 - 1;
		expect((await request(app).get(ITEMS_ROUTES.LIST)).body).toEqual(first.body);
		expect(find).toHaveBeenCalledTimes(1);
		now += 1;
		const expired = await request(app).get(ITEMS_ROUTES.LIST).set('If-None-Match', first.headers.etag);
		expect(expired.status).toBe(304);
		expect(expired.headers.etag).toBe(first.headers.etag);
		expect(find).toHaveBeenCalledTimes(2);
		await request(app).get(ITEMS_ROUTES.LIST);
		expect(find).toHaveBeenCalledTimes(2);
	});

	it('shares cached items with full-list delta resets', async () => {
		const find = vi.spyOn(Item, 'find');
		const reset = await request(app).get(ITEMS_ROUTES.CHANGES);
		expect(reset.status).toBe(200);
		expect(reset.body.full).toBe(true);
		expect(reset.headers['cache-control']).toBe('no-store');
		const list = await request(app).get(ITEMS_ROUTES.LIST);
		expect(list.body.items).toEqual(reset.body.items);
		expect(find).toHaveBeenCalledTimes(1);
	});

	it.each(['create', 'update', 'bulk update', 'delete', 'bulk delete'] as const)('invalidates the list and ETag after an API %s', async (operation) => {
		const before = await request(app).get(ITEMS_ROUTES.LIST);
		expect(before.status).toBe(200);
		let mutation: request.Response;
		switch (operation) {
			case 'create': mutation = await request(app).post(ITEMS_ROUTES.CREATE).set('Authorization', auth).send({ model: 'NEW', fiyat: 200 }); break;
			case 'update': mutation = await request(app).patch(`/items/${itemId}`).set('Authorization', auth).send({ fiyat: 75 }); break;
			case 'bulk update': mutation = await request(app).patch(ITEMS_ROUTES.BULK_UPDATE).set('Authorization', auth).send({ ids: [itemId], fields: { fiyat: 75 } }); break;
			case 'delete': mutation = await request(app).delete(`/items/${itemId}`).set('Authorization', auth); break;
			case 'bulk delete': mutation = await request(app).delete(ITEMS_ROUTES.BULK_DELETE).set('Authorization', auth).send({ ids: [itemId] }); break;
		}
		expect(mutation.status).toBe(operation === 'create' ? 201 : 200);
		const after = await request(app).get(ITEMS_ROUTES.LIST).set('If-None-Match', before.headers.etag);
		expect(after.status).toBe(200);
		expect(after.headers.etag).not.toBe(before.headers.etag);
		expect(after.body.version).toBeGreaterThan(before.body.version);
		if (operation === 'create') {
			expect(after.body.items).toHaveLength(2);
			expect(after.body.items).toContainEqual(expect.objectContaining({ model: 'NEW', fiyat: 200 }));
		} else if (operation === 'update' || operation === 'bulk update') {
			expect(after.body.items).toEqual([expect.objectContaining({ _id: itemId, fiyat: 75 })]);
		} else {
			expect(after.body.items).toEqual([]);
		}
		expect((await request(app).get(ITEMS_ROUTES.LIST).set('If-None-Match', after.headers.etag)).status).toBe(304);
	});
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => { resolve = done; });
	return { promise, resolve };
}

describe('cached fetch lifecycle', () => {
	it('shares an unfinished fetch and caches its result', async () => {
		const pending = deferred<string[]>();
		const fetch = vi.fn(() => pending.promise);
		const cache = createCachedFetcher(fetch, { ttlMs: 1000 });
		const reads = [cache.get(), cache.get(), cache.get()];
		expect(fetch).toHaveBeenCalledTimes(1);
		pending.resolve(['current']);
		expect(await Promise.all(reads)).toEqual([['current'], ['current'], ['current']]);
		expect(await cache.get()).toEqual(['current']);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('retries a rejected fetch instead of caching the failure', async () => {
		const fetch = vi.fn().mockRejectedValueOnce(new Error('Database unavailable')).mockResolvedValue(['recovered']);
		const cache = createCachedFetcher(fetch, { ttlMs: 1000 });
		await expect(cache.get()).rejects.toThrow('Database unavailable');
		expect(await cache.get()).toEqual(['recovered']);
		expect(await cache.get()).toEqual(['recovered']);
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it.each(['before', 'after'] as const)('does not restore invalidated data when the old fetch finishes %s the new fetch', async (order) => {
		const stale = deferred<string[]>();
		const fresh = deferred<string[]>();
		const fetch = vi.fn().mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise);
		const cache = createCachedFetcher(fetch, { ttlMs: 1000 });
		const oldRead = cache.get();
		cache.invalidate();
		const newRead = cache.get();
		expect(fetch).toHaveBeenCalledTimes(2);
		if (order === 'before') {
			stale.resolve(['old']);
			expect(await oldRead).toEqual(['old']);
			// The old request must not clear the newer in-flight request.
			const concurrentRead = cache.get();
			expect(fetch).toHaveBeenCalledTimes(2);
			fresh.resolve(['new']);
			expect(await concurrentRead).toEqual(['new']);
		} else {
			fresh.resolve(['new']);
			expect(await newRead).toEqual(['new']);
			stale.resolve(['old']);
			expect(await oldRead).toEqual(['old']);
		}
		expect(await newRead).toEqual(['new']);
		expect(await cache.get()).toEqual(['new']);
		expect(fetch).toHaveBeenCalledTimes(2);
	});
});
