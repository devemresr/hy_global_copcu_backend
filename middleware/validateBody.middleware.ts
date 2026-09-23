import type { Request, Response, NextFunction } from 'express';
import type { ZodTypeAny } from 'zod';
import { ValidationError } from '../errors/HttpError';
import { handleHttpError } from '../errors/handleHttpError';
import { formatZodError } from '../util/formatZodError';
import logger from '../util/logger';

const log = logger.child({ middleware: 'validateBody' });

// Parses req.body against `schema` before the route handler runs and
// replaces req.body with the parsed result (trimmed/coerced/defaulted per
// the schema), so every downstream handler only ever sees a body the schema
// already accepted - no repeating `typeof x === 'string'` checks per route.
export const validateBody = (schema: ZodTypeAny) => {
	return (req: Request, res: Response, next: NextFunction): void => {
		const result = schema.safeParse(req.body);
		if (!result.success) {
			handleHttpError(
				new ValidationError(formatZodError(result.error)),
				res,
				log,
			);
			return;
		}
		req.body = result.data;
		next();
	};
};
