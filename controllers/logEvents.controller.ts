import type { Request, Response } from 'express';
import { LogEvent } from '../models/LogEvent';
import { logEventsQuerySchema } from '../schemas/logEvent.schema';
import { ValidationError } from '../errors/HttpError';
import { handleHttpError } from '../errors/handleHttpError';
import { formatZodError } from '../util/formatZodError';
import logger from '../util/logger';

const log = logger.child({ controller: 'logEvents' });

// Query params can't go through validateBody.middleware.ts the way a POST/
// PATCH body does - Express 5 makes req.query a getter, so reassigning it
// the way validateBody reassigns req.body isn't safe. Parsed here instead.
function parseQuery(req: Request) {
	const result = logEventsQuerySchema.safeParse(req.query);
	if (!result.success) {
		throw new ValidationError(formatZodError(result.error));
	}
	return result.data;
}

// Items and pricing rules share one log_events collection (see LogEvent's
// comment), so this lists across both rather than needing a route per entity.
export const listLogEvents = async (req: Request, res: Response): Promise<void> => {
	try {
		const { page, pageSize } = parseQuery(req);
		const skip = (page - 1) * pageSize;

		const [events, total] = await Promise.all([
			LogEvent.find()
				.sort({ createdAt: -1 })
				.skip(skip)
				.limit(pageSize)
				.lean(),
			LogEvent.countDocuments(),
		]);

		res.status(200).json({
			success: true,
			events,
			total,
			page,
			pageSize,
			totalPages: Math.max(1, Math.ceil(total / pageSize)),
		});
	} catch (error) {
		handleHttpError(error, res, log);
	}
};
