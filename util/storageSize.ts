export const STORAGE_POWER_WARNING = 'Depolama değeri 2’nin kuvveti olmalıdır (ör. 8, 16, 32, 64, 128, 256, 512, 1024).';

export function isPowerOfTwo(value: number): boolean {
	return Number.isFinite(value) && value > 0 && 2 ** Math.round(Math.log2(value)) === value;
}
