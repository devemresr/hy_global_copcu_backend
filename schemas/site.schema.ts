import { z } from '../util/zodTurkish';
import { NOTICE_TYPES } from '../models/AppState';

// ISO timestamp; null/omitted means "from now" / "until turned off".
const boundSchema = z.string().datetime({ offset: true }).nullable().optional();

const scheduleSchema = z.object({
	enabled: z.boolean(),
	message: z.string().trim().max(1000).nullable().optional(),
	from: boundSchema,
	until: boundSchema,
});

const fromBeforeUntil = <
	T extends { from?: string | null; until?: string | null },
>(
	value: T,
) =>
	!value.from || !value.until || new Date(value.from) < new Date(value.until);
const fromBeforeUntilMessage = {
	message: 'Başlangıç tarihi bitiş tarihinden önce olmalıdır.',
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
			.array(z.string().regex(/^\/[\w\-/]*$/, 'Sayfa yolu geçersiz.'))
			.max(20),
		dismissible: z.boolean(),
	})
	.refine(fromBeforeUntil, fromBeforeUntilMessage);

export type UpdateMaintenanceInput = z.infer<typeof updateMaintenanceSchema>;
export type UpdateNoticeInput = z.infer<typeof updateNoticeSchema>;

export const updatePromotionSchema = z
	.object({
		brandLabel: z.string().trim().min(1).max(120).nullable().default(null),
		enabled: z.boolean(),
		showEveryVisit: z.boolean(),
		title: z.string().trim().min(1).max(160).nullable(),
		tagline: z.string().trim().min(1).max(120).nullable(),
		description: z.string().trim().min(1).max(1000).nullable(),
	})
	.strict();
