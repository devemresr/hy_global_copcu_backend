import { z } from 'zod';

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
});

export type LogEventsQuery = z.infer<typeof logEventsQuerySchema>;
