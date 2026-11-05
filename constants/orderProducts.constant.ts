export const ORDER_MEMORY_SIZES = [8, 16, 32, 64, 128, 256, 512, 1024] as const;
export const ORDER_PRODUCT_TYPES = {
	EMMC: { label: 'eMMC', requiresMemorySize: true },
	EMCP: { label: 'eMCP', requiresMemorySize: true },
	IPHONE: { label: 'iPhone', requiresMemorySize: false },
	TABLET: { label: 'Tablet', requiresMemorySize: false },
} as const;
export const ORDER_QUANTITY_UNITS = ['piece', 'kg', 'g'] as const;
