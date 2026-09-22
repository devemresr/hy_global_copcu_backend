type CacheEntry<T> = {
	value: T;
	expiresAt: number;
};

/**
 * Wraps a fetch function in an in-memory, TTL-based cache for hot-path reads
 * over data that rarely changes. This runs as a single VPS process, so there's
 * no other instance that needs to see the same cached value - a plain
 * in-process cache gets the same win as Redis here (skip the Mongo round
 * trip) without a network hop to a separate service or anything extra to run.
 *
 * Concurrent calls while the cache is cold/expired share one in-flight fetch
 * instead of each triggering their own Mongo query.
 *
 * Usage once a real route/model exists:
 *
 *   const inventoryCache = createCachedFetcher(
 *     () => InventoryItem.find().lean(),
 *     { ttlMs: 5 * 60 * 1000 },
 *   );
 *
 *   router.get('/inventory', async (req, res) => {
 *     res.json(await inventoryCache.get());
 *   });
 *
 *   router.put('/inventory/:id', async (req, res) => {
 *     await InventoryItem.findByIdAndUpdate(req.params.id, req.body);
 *     inventoryCache.invalidate(); // next read is guaranteed fresh
 *     res.sendStatus(204);
 *   });
 */
export function createCachedFetcher<T>(
	fetchFn: () => Promise<T>,
	{ ttlMs }: { ttlMs: number },
) {
	let entry: CacheEntry<T> | null = null;
	let inFlight: Promise<T> | null = null;

	const get = (): Promise<T> => {
		if (entry && entry.expiresAt > Date.now()) {
			return Promise.resolve(entry.value);
		}

		if (!inFlight) {
			inFlight = fetchFn()
				.then((value) => {
					entry = { value, expiresAt: Date.now() + ttlMs };
					return value;
				})
				.finally(() => {
					inFlight = null;
				});
		}

		return inFlight;
	};

	const invalidate = () => {
		entry = null;
	};

	return { get, invalidate };
}
