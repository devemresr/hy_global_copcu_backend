import { z } from '../util/zodTurkish';
export const inventorySnapshotScheduleSchema = z
	.object({
		intervalMinutes: z
			.number()
			.int()
			.min(1, 'Yenileme aralığı en az 1 dakika olmalıdır.')
			.max(10080, 'Yenileme aralığı en fazla 7 gün olabilir.'),
	})
	.strict();
