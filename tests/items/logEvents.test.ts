import { describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../../app';
import { LogEvent, LOG_ACTIONS, LOG_ENTITY_TYPES } from '../../models/LogEvent';
import { LOG_EVENTS_ROUTES } from '../../routes/routes.constant';
import { loginAndGetTokens } from '../helpers';

describe('exact model log search', () => {
	it('matches the whole model literally, supports case sensitivity, and filters before grouping', async () => {
		const adminId = new mongoose.Types.ObjectId();
		const base = { adminId, adminUsername: 'tester', action: LOG_ACTIONS.ITEMS_UPDATE, entityType: LOG_ENTITY_TYPES.ITEM };
		await LogEvent.create([
			{ ...base, entityKey: 'PA[1].+', batchId: 'batch' },
			{ ...base, entityKey: 'OTHER', batchId: 'batch' },
			{ ...base, entityKey: 'pa[1].+' },
			{ ...base, entityKey: 'XPA[1].+Y' },
			{ ...base, entityKey: 'PA[1].+', entityType: LOG_ENTITY_TYPES.ITEM_RULE },
		]);
		const { accessToken } = await loginAndGetTokens();
		const search = (query: Record<string, string | number>) => request(app).get(LOG_EVENTS_ROUTES.LIST).set('Authorization', `Bearer ${accessToken}`).query(query);
		const insensitive = await search({ model: 'PA[1].+' });
		expect(insensitive.status).toBe(200);
		expect(insensitive.body.total).toBe(2);
		expect(insensitive.body.events.map((event: { entityKey: string }) => event.entityKey).sort()).toEqual(['PA[1].+', 'pa[1].+']);
		const sensitive = await search({ model: 'PA[1].+', caseSensitive: 'true' });
		expect(sensitive.body.total).toBe(1);
		expect(sensitive.body.events).toHaveLength(1);
		expect(sensitive.body.events[0].entityKey).toBe('PA[1].+');
		const paginated = await search({ model: 'PA[1].+', pageSize: 1 });
		expect(paginated.body.totalPages).toBe(2);
		expect(paginated.body.events).toHaveLength(1);
		expect((await search({ model: 'PA' })).body.total).toBe(0);
		expect((await search({ caseSensitive: 'maybe' })).status).toBe(400);
	});
});
