import { expect, it } from 'vitest';
import { stockConversionLines } from '../../services/stockConversionLines';
import { stockConversionSchema } from '../../schemas/stockConversion.schema';
const line = {
	sourceLotId: 'purchase:0',
	orderId: 'purchase',
	bayiId: 'supplier',
	bayiName: 'Bayi',
	type: 'EMMC',
	memoryGb: 8,
	fromUnit: 'piece',
	fromQuantity: 10,
	toUnit: 'g',
	toQuantity: 250,
	sourceQuantity: 10,
	targetQuantity: 0.25,
	cost: 100,
};
it('reads a legacy conversion without treating operation metadata as line fields', () => {
	const legacy = {
		...line,
		_id: 'conversion',
		requestId: 'request',
		note: 'Ölçülen ağırlık',
		createdAt: new Date(),
		createdBy: 'admin',
		adminUsername: 'admin',
		__v: 0,
	};
	expect(stockConversionLines(legacy)).toEqual([line]);
});
it('reads all supplier lines from a conversion batch and strips persistence metadata', () => {
	expect(
		stockConversionLines({
			lines: [
				{ ...line, _id: 'line-1' },
				{ ...line, sourceLotId: 'purchase:1', bayiId: 'other', __v: 0 },
			],
		}),
	).toEqual([line, { ...line, sourceLotId: 'purchase:1', bayiId: 'other' }]);
});
it('still rejects invalid quantities in persisted conversion lines', () => {
	expect(() =>
		stockConversionLines({ lines: [{ ...line, targetQuantity: 0 }] }),
	).toThrow();
});
it('keeps conversion request objects strict', () => {
	const { sourceLotId, fromUnit, fromQuantity, toUnit, toQuantity } = line;
	expect(
		stockConversionSchema.safeParse({
			requestId: '11111111-1111-4111-8111-111111111111',
			lines: [
				{
					sourceLotId,
					fromUnit,
					fromQuantity,
					toUnit,
					toQuantity,
					_id: 'unexpected',
				},
			],
			note: '',
		}).success,
	).toBe(false);
});
