import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

/**
 * /api/bgcs when the browse index cannot answer.
 *
 * A transient index failure (a stall, a dropped connection, a 5xx) is retried
 * once before the SQL fallback runs; a 4xx is about the request and is not. The
 * fallback itself is guarded: two requests at a time, 45 s per query, and what
 * does not fit is a 503 the reader can read rather than a 120 s hang and a 500.
 * `@/lib/prisma` is mocked, as in order-by-tiebreak.test.ts: nothing here runs SQL.
 */

const { queryRaw, executeRaw, search, gateMode } = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  executeRaw: vi.fn(async () => 0),
  search: vi.fn(),
  gateMode: { busy: false },
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    $queryRaw: queryRaw,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ $queryRaw: queryRaw, $executeRawUnsafe: executeRaw }),
  },
}));

vi.mock('@/lib/cache', async (orig) => ({
  ...(await orig<typeof import('@/lib/cache')>()),
  getOrSetCache: async (_k: string, fetcher: () => Promise<unknown>) => fetcher(),
}));

vi.mock('@/lib/opensearch/known-cluster-decorations', () => ({
  withKnownClusterHits: async <T,>(rows: T[]) => rows,
}));

const indexState = { on: true };
vi.mock('@/lib/opensearch/browse-client', async (orig) => {
  const actual = await orig<typeof import('@/lib/opensearch/browse-client')>();
  const unexpected = async () => { throw new Error('not expected at offset 0'); };
  return {
    ...actual,
    isBrowseSearchEnabled: () => indexState.on,
    searchBrowseIndex: search,
    countBrowseIndex: unexpected,
    sortKeysBrowseIndex: unexpected,
    aggregateBrowseIndex: unexpected,
    searchBrowseIndexWithBody: unexpected,
  };
});

vi.mock('@/lib/api/concurrency-gate', async (orig) => {
  const actual = await orig<typeof import('@/lib/api/concurrency-gate')>();
  return {
    ...actual,
    createConcurrencyGate: () => ({
      run: <T,>(fn: () => Promise<T>) => (gateMode.busy ? Promise.reject(new actual.GateBusyError()) : fn()),
      active: 2,
      waiting: 1,
    }),
  };
});

const call = async (query: string) => {
  const { GET } = await import('./route');
  const res = await GET(new Request(`http://localhost/api/bgcs?${query}`));
  return { status: res.status, headers: res.headers, json: await res.json() as Record<string, unknown> };
};

const timeout = () => new DOMException('The operation was aborted due to timeout', 'TimeoutError');

beforeEach(() => {
  queryRaw.mockReset().mockResolvedValue([]);
  executeRaw.mockClear();
  search.mockReset();
  indexState.on = true;
  gateMode.busy = false;
});

describe('isTransientBrowseError', () => {
  it('retries stalls, dropped connections and an overloaded index, not a refused request', async () => {
    const { isTransientBrowseError, BrowseIndexHttpError } = await vi.importActual<typeof import('@/lib/opensearch/browse-client')>('@/lib/opensearch/browse-client');
    expect(isTransientBrowseError(timeout())).toBe(true);
    expect(isTransientBrowseError(new TypeError('fetch failed'))).toBe(true);
    expect(isTransientBrowseError(new BrowseIndexHttpError(503, 'unavailable'))).toBe(true);
    expect(isTransientBrowseError(new BrowseIndexHttpError(429, 'too many'))).toBe(true);
    expect(isTransientBrowseError(new BrowseIndexHttpError(400, 'Result window is too large'))).toBe(false);
    expect(isTransientBrowseError(new Error('something else'))).toBe(false);
    expect(isTransientBrowseError('timeout')).toBe(false);
  });
});

describe('/api/bgcs index retry', () => {
  it('answers from the index after one stall, without touching the database', async () => {
    search.mockRejectedValueOnce(timeout()).mockResolvedValueOnce({ total: 3, documents: [] });
    const { status, json } = await call('limit=50&offset=0');
    expect(status).toBe(200);
    expect((json.data as { total: number }).total).toBe(3);
    expect(search).toHaveBeenCalledTimes(2);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  // A refused query is the caller's to fix. The fallback used to run it on SQL anyway:
  // ?lengthMin=1e20 spent 45 s and two pool connections to reach a 503 that blamed
  // the index (2026-10-21).
  const rejection = (status: number, type: string, reason: string) =>
    JSON.stringify({ error: { root_cause: [{ type, reason }] }, status });

  it('answers a refused query with a 400 at once: no retry, no database', async () => {
    const { BrowseIndexHttpError } = await vi.importActual<typeof import('@/lib/opensearch/browse-client')>('@/lib/opensearch/browse-client');
    search.mockRejectedValue(new BrowseIndexHttpError(400, rejection(400, 'query_shard_exception',
      'failed to create query: Value [1e20] is out of range for a long')));
    const { status, json } = await call('limit=50&offset=0&lengthMin=99999999999999999999');
    expect(status).toBe(400);
    expect(String(json.error)).toMatch(/outside what the search accepts/);
    expect(String(json.error)).not.toMatch(/bgc_browse|shard/);
    expect(search).toHaveBeenCalledTimes(1);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('treats an out-of-range int, which OpenSearch answers with a 500, as refused too', async () => {
    const { BrowseIndexHttpError } = await vi.importActual<typeof import('@/lib/opensearch/browse-client')>('@/lib/opensearch/browse-client');
    search.mockRejectedValue(new BrowseIndexHttpError(500, rejection(500, 'input_coercion_exception',
      'Numeric value (9007199254740991) out of range of int')));
    const { status } = await call('limit=50&offset=0&genesMin=9007199254740991');
    expect(status).toBe(400);
    expect(search).toHaveBeenCalledTimes(1);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('still retries and falls back on a 500 that is an outage', async () => {
    const { BrowseIndexHttpError } = await vi.importActual<typeof import('@/lib/opensearch/browse-client')>('@/lib/opensearch/browse-client');
    search.mockRejectedValue(new BrowseIndexHttpError(500, rejection(500, 'node_not_connected_exception', 'gone')));
    const { status } = await call('limit=50&offset=0&latMin=36&latMax=37');
    expect(status).toBe(200);
    expect(search).toHaveBeenCalledTimes(2);
    expect(queryRaw).toHaveBeenCalled();
  });

  it('falls back after a second stall', async () => {
    search.mockRejectedValue(timeout());
    const { status } = await call('limit=50&offset=0&latMin=36&latMax=37');
    expect(status).toBe(200);
    expect(search).toHaveBeenCalledTimes(2);
    expect(queryRaw).toHaveBeenCalled();
  });
});

describe('/api/bgcs SQL fallback guard', () => {
  beforeEach(() => { indexState.on = false; });

  it('gives each fallback query 45 s, not the 120 s default', async () => {
    await call('limit=50&offset=0&latMin=36&latMax=37');
    expect(executeRaw).toHaveBeenCalledWith("SET LOCAL statement_timeout = '45s'");
  });

  it('answers a query past 45 s with a 503 the reader can read', async () => {
    queryRaw.mockRejectedValue(new Prisma.PrismaClientKnownRequestError(
      'Raw query failed. Code: `57014`. Message: `ERROR: canceling statement due to statement timeout`',
      { code: 'P2010', clientVersion: 'test', meta: { code: '57014' } },
    ));
    const { status, headers, json } = await call('limit=50&offset=0&latMin=36&latMax=37');
    expect(status).toBe(503);
    expect(headers.get('Retry-After')).toBe('30');
    expect(json).toEqual({
      success: false,
      userFacing: true,
      error: 'The search index is temporarily unavailable, and this search is too large for the backup to answer in time. '
        + 'Try a smaller area or fewer filters, or try again shortly.',
    });
  });

  it('answers a caller over the concurrency cap with a 503, not a queue on the pool', async () => {
    gateMode.busy = true;
    const { status, headers, json } = await call('limit=50&offset=0&latMin=36&latMax=37');
    expect(status).toBe(503);
    expect(headers.get('Retry-After')).toBe('30');
    expect(json.error).toBe('The search index is temporarily unavailable and the backup search is busy. Please try again in a minute.');
    expect(json.userFacing).toBe(true);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('still answers any other database failure with the generic 500', async () => {
    queryRaw.mockRejectedValue(new Error('connection reset'));
    const { status, json } = await call('limit=50&offset=0&latMin=36&latMax=37');
    expect(status).toBe(500);
    expect(json.userFacing).toBeUndefined();
  });
});
