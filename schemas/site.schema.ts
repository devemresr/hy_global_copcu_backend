import { z } from 'zod';
import { NOTICE_TYPES } from '../models/AppState';

// ISO timestamp; null/omitted means "from now" / "until turned off".
const boundSchema = z.string().datetime({ offset: true }).nullable().optional();

const scheduleSchema = z.object({
	enabled: z.boolean(),
	message: z.string().trim().max(1000).nullable().optional(),
	from: boundSchema,
	until: boundSchema,
});

const fromBeforeUntil = <T extends { from?: string | null; until?: string | null }>(
	value: T,
) => !value.from || !value.until || new Date(value.from) < new Date(value.until);
const fromBeforeUntilMessage = {
	message: 'from must be before until',
	path: ['until'],
};

export const updateMaintenanceSchema = scheduleSchema.refine(
	fromBeforeUntil,
	fromBeforeUntilMessage,
);

export const updateNoticeSchema = scheduleSchema
	.extend({
		type: z.enum(NOTICE_TYPES),
		pages: z
			.array(z.string().regex(/^\/[\w\-/]*$/, 'Invalid page path'))
			.max(20),
		dismissible: z.boolean(),
	})
	.refine(fromBeforeUntil, fromBeforeUntilMessage);

export type UpdateMaintenanceInput = z.infer<typeof updateMaintenanceSchema>;
export type UpdateNoticeInput = z.infer<typeof updateNoticeSchema>;
