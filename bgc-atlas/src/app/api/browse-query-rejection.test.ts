import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * /api/gcfs and /api/samples when the browse index refuses the QUERY -- a value out
 * of range for the field, a page past the result window. Both fell back to SQL,
 * which cannot answer it either: the reader waited for a misleading error and the
 * pool lost connections for it. /api/bgcs is pinned in bgcs/fallback-guard.test.ts.
 */

const { queryRaw, search } = vi.hoisted(() => ({ queryRaw: vi.fn(), search: vi.fn() }));

vi.mock('@/lib/prisma', () => ({
  default: {
    $queryRaw: queryRaw,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ $queryRaw: queryRaw, $executeRawUnsafe: async () => 0 }),
  },
}));
vi.mock('@/lib/redis-client', () => ({
  default: { get: async () => null, set: async () => 'OK', scan: async () => ['0', []], del: async () => 0 },
}));
vi.mock('@/lib/opensearch/browse-client', async (orig) => ({
  ...(await orig<typeof import('@/lib/opensearch/browse-client')>()),
  isBrowseSearchEnabled: () => true,
  searchBrowseIndex: search,
}));

const { BrowseIndexHttpError } = await vi.importActual<typeof import('@/lib/opensearch/browse-client')>(
  '@/lib/opensearch/browse-client');
const body = (status: number, type: string, reason: string) =>
  JSON.stringify({ error: { root_cause: [{ type, reason }] }, status });

type Handler = (request: Request) => Promise<Response>;
const ROUTES: [string, () => Promise<{ GET: Handler }>][] = [
  ['/api/gcfs', () => import('@/app/api/gcfs/route') as Promise<{ GET: Handler }>],
  ['/api/samples', () => import('@/app/api/samples/route') as Promise<{ GET: Handler }>],
];

beforeEach(() => { queryRaw.mockReset().mockResolvedValue([]); search.mockReset(); });

describe.each(ROUTES)('%s on a refused query', (path, load) => {
  const call = async (query: string) => {
    const { GET } = await load();
    const res = await GET(new Request(`http://localhost${path}?${query}`));
    return { status: res.status, json: await res.json() as Record<string, unknown> };
  };

  it('answers an out-of-range value with a 400, without the database', async () => {
    search.mockRejectedValue(new BrowseIndexHttpError(400, body(400, 'query_shard_exception',
      'failed to create query: Value [1e20] is out of range for a long')));
    const { status, json } = await call('limit=50');
    expect(status).toBe(400);
    expect(String(json.error)).toMatch(/outside what the search accepts/);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('answers a page past the window with a 400 that says so, without the database', async () => {
    search.mockRejectedValue(new BrowseIndexHttpError(400, body(400, 'illegal_argument_exception',
      'Result window is too large, from + size must be less than or equal to: [1250000] but was [2000050].')));
    const { status, json } = await call('limit=50&offset=2000000');
    expect(status).toBe(400);
    expect(String(json.error)).toMatch(/Cannot page this far/);
    // The list keeps its pager for this one (see refusal-codes.ts).
    expect(json.code).toBe('deep_page');
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('answers an out-of-range int (a 500 from OpenSearch) with a 400 too', async () => {
    search.mockRejectedValue(new BrowseIndexHttpError(500, body(500, 'input_coercion_exception',
      'Numeric value (9007199254740991) out of range of int')));
    const { status, json } = await call('limit=50');
    expect(status).toBe(400);
    // Names no filter, so no code: the page shows the sentence alone.
    expect(json.code).toBeUndefined();
    expect(queryRaw).not.toHaveBeenCalled();
  });
});

describe('isBrowseQueryRejection', () => {
  it('is a 400, or a 500 coercion failure; never an outage', async () => {
    const { isBrowseQueryRejection, isTransientBrowseError } = await vi.importActual<
      typeof import('@/lib/opensearch/browse-client')>('@/lib/opensearch/browse-client');
    const coercion = new BrowseIndexHttpError(500, body(500, 'input_coercion_exception', 'out of range of int'));
    expect(isBrowseQueryRejection(new BrowseIndexHttpError(400, 'not json'))).toBe(true);
    expect(isBrowseQueryRejection(coercion)).toBe(true);
    expect(isTransientBrowseError(coercion)).toBe(false);
    for (const outage of [
      new BrowseIndexHttpError(500, body(500, 'node_not_connected_exception', 'gone')),
      new BrowseIndexHttpError(500, 'not json'),
      new BrowseIndexHttpError(503, 'unavailable'),
      new BrowseIndexHttpError(429, 'too many'),
    ]) {
      expect(isBrowseQueryRejection(outage)).toBe(false);
      expect(isTransientBrowseError(outage)).toBe(true);
    }
    expect(isBrowseQueryRejection(new Error('x'))).toBe(false);
  });
});
