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

// A bulk edit writes one raw document per row it touches, all sharing one
// batchId (see LogEvent model's own comment) - paginating over raw documents
// the way a plain `.find().skip().limit()` would means a single bulk edit's
// rows can land on several different pages, each looking like its own
// separate bulk event. Grouping first (batchId when set, each document's own
// _id otherwise, so a solo edit is still its own group of one) and paginating
// over *those* groups is what keeps a bulk edit as the one logical event it
// actually was, and keeps `total`/`totalPages` counting real events instead
// of raw rows.
const GROUP_BY_BATCH_OR_SELF = { $ifNull: ['$batchId', '$_id'] };

// Items and pricing rules share one log_events collection (see LogEvent's
// comment), so this lists across both rather than needing a route per entity.
export const listLogEvents = async (req: Request, res: Response): Promise<void> => {
	try {
		const { page, pageSize } = parseQuery(req);
		const skip = (page - 1) * pageSize;

		const [groupsPage, totalCount] = await Promise.all([
			LogEvent.aggregate<{ events: unknown[]; latestCreatedAt: Date }>([
				{ $sort: { createdAt: -1 } },
				{
					$group: {
						_id: GROUP_BY_BATCH_OR_SELF,
						events: { $push: '$$ROOT' },
						latestCreatedAt: { $max: '$createdAt' },
					},
				},
				{ $sort: { latestCreatedAt: -1 } },
				{ $skip: skip },
				{ $limit: pageSize },
			]),
			LogEvent.aggregate<{ total: number }>([
				{ $group: { _id: GROUP_BY_BATCH_OR_SELF } },
				{ $count: 'total' },
			]).then((result) => result[0]?.total ?? 0),
		]);

		const events = groupsPage.flatMap((group) => group.events);

		res.status(200).json({
			success: true,
			events,
			total: totalCount,
			page,
			pageSize,
			totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
		});
	} catch (error) {
		handleHttpError(error, res, log);
	}
};
