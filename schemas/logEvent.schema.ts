import { z } from 'zod';
import { LOG_ENTITY_TYPES } from '../models/LogEvent';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

// z.coerce.number() turns the string query params Express always hands back
// ("2") into actual numbers before the min/int/max checks run.
export const logEventsQuerySchema = z.object({
	page: z.coerce.number().int().min(1).optional().default(1),
	pageSize: z.coerce
		.number()
		.int()
		.min(1)
		.max(MAX_PAGE_SIZE)
		.optional()
		.default(DEFAULT_PAGE_SIZE),
	// Comma-separated entity types to include; omitted means all.
	types: z
		.string()
		.optional()
		.transform((value) => (value ? value.split(',') : []))
		.pipe(z.array(z.enum(Object.values(LOG_ENTITY_TYPES) as [string, ...string[]]))),
});

export type LogEventsQuery = z.infer<typeof logEventsQuerySchema>;
