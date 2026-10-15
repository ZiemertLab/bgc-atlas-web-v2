import { describe, it, expect, vi, beforeEach } from 'vitest';

// The cache module talks to a real Redis singleton; swap it for a stub so these
// tests exercise the caching logic alone.
const redis = {
  get: vi.fn<(key: string) => Promise<string | null>>(),
  set: vi.fn<(...args: unknown[]) => Promise<string>>(),
};
vi.mock('@/lib/redis-client', () => ({ default: redis }));

const { getOrSetCache, getOrSetCacheWithMetadata, buildCacheKey } = await import('@/lib/cache');

beforeEach(() => {
  redis.get.mockReset().mockResolvedValue(null);
  redis.set.mockReset().mockResolvedValue('OK');
});

describe('getOrSetCache — cache hit', () => {
  it('returns the cached value without calling the fetcher', async () => {
    redis.get.mockResolvedValue(JSON.stringify({ hello: 'world' }));
    const fetcher = vi.fn().mockResolvedValue({ hello: 'fresh' });

    const result = await getOrSetCacheWithMetadata('k', fetcher, 60);

    expect(result).toEqual({ data: { hello: 'world' }, isHit: true });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('re-fetches when the cached payload is not valid JSON', async () => {
    redis.get.mockResolvedValue('{not json');
    const fetcher = vi.fn().mockResolvedValue('fresh');

    await expect(getOrSetCache('k', fetcher)).resolves.toBe('fresh');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('getOrSetCache — cache miss', () => {
  it('calls the fetcher exactly once and stores the result with the TTL', async () => {
    const fetcher = vi.fn().mockResolvedValue({ n: 1 });

    const result = await getOrSetCacheWithMetadata('k', fetcher, 3600);

    expect(result).toEqual({ data: { n: 1 }, isHit: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith('k', JSON.stringify({ n: 1 }), 'EX', 3600);
  });

  it('does not cache null or undefined results', async () => {
    await getOrSetCache('k', vi.fn().mockResolvedValue(null));
    await getOrSetCache('k', vi.fn().mockResolvedValue(undefined));
    expect(redis.set).not.toHaveBeenCalled();
  });
});

describe('getOrSetCache — the fetcher runs exactly once', () => {
  it('propagates a fetcher failure instead of running it again', async () => {
    // The fetcher runs exactly once: a retry would burn a statement timeout twice.
    const fetcher = vi.fn().mockRejectedValue(new Error('statement timeout'));

    await expect(getOrSetCache('k', fetcher)).rejects.toThrow('statement timeout');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not re-run the fetcher when writing to Redis fails', async () => {
    redis.set.mockRejectedValue(new Error('redis down'));
    const fetcher = vi.fn().mockResolvedValue('fresh');

    await expect(getOrSetCache('k', fetcher)).resolves.toBe('fresh');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('getOrSetCache — Redis outages', () => {
  it('treats a failed read as a miss and still serves fresh data', async () => {
    redis.get.mockRejectedValue(new Error('redis down'));
    const fetcher = vi.fn().mockResolvedValue('fresh');

    const result = await getOrSetCacheWithMetadata('k', fetcher, 60);

    expect(result).toEqual({ data: 'fresh', isHit: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('surfaces the fetcher error when Redis is down too, without a retry', async () => {
    redis.get.mockRejectedValue(new Error('redis down'));
    const fetcher = vi.fn().mockRejectedValue(new Error('db down'));

    await expect(getOrSetCache('k', fetcher)).rejects.toThrow('db down');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('buildCacheKey', () => {
  it('places the version AFTER the namespace so existing invalidation globs still match', () => {
    const key = buildCacheKey('stats:global', 2, { sourceTypes: [] });
    expect(key.startsWith('stats:global:v2:')).toBe(true);
  });

  it('rejects a version that is not a positive integer', () => {
    expect(() => buildCacheKey('stats:global', 0, {})).toThrow();
    expect(() => buildCacheKey('stats:global', 1.5, {})).toThrow();
    expect(() => buildCacheKey('stats:global', NaN, {})).toThrow();
  });

  it('is independent of the order the inputs were supplied in', () => {
    expect(buildCacheKey('n', 1, { a: 1, b: 2 })).toBe(buildCacheKey('n', 1, { b: 2, a: 1 }));
  });

  it('sorts nested object keys too', () => {
    expect(buildCacheKey('n', 1, { g: { x: 1, y: 2 } })).toBe(buildCacheKey('n', 1, { g: { y: 2, x: 1 } }));
  });

  it('does NOT sort arrays — order is the caller\'s semantics to decide', () => {
    expect(buildCacheKey('n', 1, { v: ['b', 'a'] })).not.toBe(buildCacheKey('n', 1, { v: ['a', 'b'] }));
  });

  it('treats an undefined or null input as absent', () => {
    expect(buildCacheKey('n', 1, { a: 1, b: undefined })).toBe(buildCacheKey('n', 1, { a: 1 }));
    expect(buildCacheKey('n', 1, { a: 1, b: null })).toBe(buildCacheKey('n', 1, { a: 1 }));
  });

  it('distinguishes inputs that differ only in value', () => {
    expect(buildCacheKey('n', 1, { a: 1 })).not.toBe(buildCacheKey('n', 1, { a: 2 }));
    expect(buildCacheKey('n', 1, { a: '1' })).not.toBe(buildCacheKey('n', 1, { a: 1 }));
  });

  it('distinguishes versions', () => {
    expect(buildCacheKey('n', 1, { a: 1 })).not.toBe(buildCacheKey('n', 2, { a: 1 }));
  });
});
