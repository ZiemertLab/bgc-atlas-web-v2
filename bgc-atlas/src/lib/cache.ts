import client from './redis-client';

export async function getOrSetCacheWithMetadata<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl: number = 300
): Promise<{ data: T; isHit: boolean }> {
    // Redis is best-effort and failures degrade to "no cache"; the fetcher runs exactly once and
    // its failures propagate (a retry would double the cost of the slowest queries).
    let cachedData: string | null = null;
    try {
        cachedData = await client.get(key);
    } catch (getError) {
        console.error(`Failed to read cache for key ${key}`, getError);
    }

    if (cachedData) {
        try {
            return { data: JSON.parse(cachedData) as T, isHit: true };
        } catch (parseError) {
            console.error(`Failed to parse cache for key ${key}`, parseError);
            // Unreadable entry — fall through and fetch fresh data.
        }
    }

    const freshData = await fetcher();

    if (freshData !== undefined && freshData !== null) {
        try {
            // Stringify inside the try: an unserializable value must not cost the fetched data.
            await client.set(key, JSON.stringify(freshData), 'EX', ttl);
        } catch (setError) {
            console.error(`Failed to set cache for key ${key}`, setError);
        }
    }

    return { data: freshData, isHit: false };
}

export async function getOrSetCache<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl: number = 300
): Promise<T> {
    const { data } = await getOrSetCacheWithMetadata(key, fetcher, ttl);
    return data;
}

// SCAN rather than KEYS so a large keyspace never stalls Redis. Best-effort: errors are logged
// and return 0.
export async function invalidateCache(pattern: string): Promise<number> {
    try {
        let cursor = '0';
        let deleted = 0;
        do {
            const [next, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
            cursor = next;
            if (keys.length > 0) {
                deleted += await client.del(...keys);
            }
        } while (cursor !== '0');
        return deleted;
    } catch (error) {
        console.error(`Failed to invalidate cache for pattern ${pattern}`, error);
        return 0;
    }
}

// The count depends only on the WHERE inputs, so it gets its own key and survives page/sort changes.
export function buildListCacheKeys(
    scope: string,
    params: URLSearchParams,
    nonFilterKeys: readonly string[]
): { dataKey: string; countKey: string } {
    const nonFilter = new Set(nonFilterKeys);
    const all: [string, string][] = [];
    const filterOnly: [string, string][] = [];
    for (const [k, v] of params.entries()) {
        all.push([k, v]);
        if (!nonFilter.has(k)) {
            filterOnly.push([k, v]);
        }
    }
    const cmp = (a: [string, string], b: [string, string]) =>
        a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1;
    all.sort(cmp);
    filterOnly.sort(cmp);
    return {
        dataKey: `${scope}:data:${JSON.stringify(all)}`,
        countKey: `${scope}:count:${JSON.stringify(filterOnly)}`,
    };
}

// Anything JSON-serialisable without a `toJSON` hook, so serialisation is total and stable.
export type CacheKeyValue =
    | string
    | number
    | boolean
    | null
    | undefined
    | readonly CacheKeyValue[]
    | { readonly [key: string]: CacheKeyValue };

/** Recursively key-sorted JSON, so two equal inputs always serialize alike. */
function stableStringify(value: CacheKeyValue): string {
    if (value === undefined || value === null) return 'null';
    if (Array.isArray(value)) {
        return `[${value.map((entry) => stableStringify(entry as CacheKeyValue)).join(',')}]`;
    }
    if (typeof value === 'object') {
        const entries = Object.entries(value as Record<string, CacheKeyValue>)
            .filter(([, v]) => v !== undefined && v !== null)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
        return `{${entries.join(',')}}`;
    }
    // NaN and Infinity have no JSON form; JSON.stringify renders both as null.
    return JSON.stringify(value) ?? 'null';
}

/**
 * Deterministic Redis key from a request's parsed inputs: object keys are sorted at every depth and
 * null/undefined entries dropped. Arrays are not sorted (a sort-field list is a sequence), so
 * callers dedupe and sort set-like inputs such as `sourceType` themselves.
 *
 * The version goes after the namespace (`stats:global:v2:…`) so the invalidation globs in
 * lib/stats-cache.ts keep matching. Bump it whenever the payload's shape or meaning changes.
 */
export function buildCacheKey(
    namespace: string,
    version: number,
    inputs: Record<string, CacheKeyValue>
): string {
    if (!namespace) {
        throw new Error('buildCacheKey requires a namespace');
    }
    if (!Number.isInteger(version) || version < 1) {
        throw new Error(`buildCacheKey requires a positive integer version, got ${version}`);
    }
    return `${namespace}:v${version}:${stableStringify(inputs)}`;
}
