import { z } from 'zod';

export const CURRENCY_VALUES = ['TRY', 'USD'] as const;
export const currencySchema = z.enum(CURRENCY_VALUES);
export type Currency = z.infer<typeof currencySchema>;

export const STORAGE_UNIT_VALUES = ['GB', 'TB'] as const;
export const storageUnitSchema = z.enum(STORAGE_UNIT_VALUES);
export type StorageUnit = z.infer<typeof storageUnitSchema>;

// The canonical shape of an item's editable fields and what a valid value
// looks like for each - ItemData's paraBirimi/model types (models/Item.ts),
// items.controller.ts's create/update handling, and EDITABLE_ITEM_FIELDS
// below all derive from this instead of a hand-maintained field list plus
// ad hoc `typeof`/range checks scattered across the controller. depolama/
// fiyat each split into a plain magnitude plus a required unit
// (depolamaBirimi/paraBirimi) rather than one combined string like "128GB".
export const editableItemFieldsSchema = z.object({
	model: z.string().trim().min(1, 'Model is required'),
	bellekTipi: z.string().trim().min(1).nullable().optional(),
	depolama: z.number().positive('depolama must be a positive number').nullable(),
	depolamaBirimi: storageUnitSchema,
	ram: z.string().trim().min(1).nullable().optional(),
	fiyat: z.number().nonnegative('fiyat must be a non-negative number').nullable(),
	paraBirimi: currencySchema,
});

// Create only requires model - the rest fall back to the schema's own
// defaults/nullability (paraBirimi/depolamaBirimi still aren't optional here
// since Mongoose's own default only applies when the key is absent from the
// insert doc at all, and `.partial()` is what makes a key absent-able).
export const createItemSchema = editableItemFieldsSchema.partial({
	bellekTipi: true,
	depolama: true,
	depolamaBirimi: true,
	ram: true,
	fiyat: true,
	paraBirimi: true,
});

// A PATCH only ever sends the fields it's actually changing.
export const updateItemSchema = editableItemFieldsSchema.partial();

// Capped at 1000 ids mostly as abuse/typo insurance - BulkEditPanel's filter
// conditions could in principle match far more rows than anyone actually
// means to touch in one request.
export const bulkUpdateItemsSchema = z.object({
	ids: z
		.array(z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid item id'))
		.min(1, 'At least one item id is required')
		.max(1000, 'Too many items in one bulk update'),
	fields: updateItemSchema.refine(
		(fields) => Object.keys(fields).length > 0,
		{ message: 'At least one field to update is required' },
	),
});

export type CreateItemInput = z.infer<typeof createItemSchema>;
export type UpdateItemInput = z.infer<typeof updateItemSchema>;
export type BulkUpdateItemsInput = z.infer<typeof bulkUpdateItemsSchema>;

export const EDITABLE_ITEM_FIELDS = Object.keys(
	editableItemFieldsSchema.shape,
) as (keyof typeof editableItemFieldsSchema.shape)[];
