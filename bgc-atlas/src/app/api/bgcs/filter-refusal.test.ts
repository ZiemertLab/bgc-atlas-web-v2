import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Every route that reads the /bgcs filter params refuses a sourceType, goldBucket
 * or completeness it cannot honour, with the same 400, on either backend.
 *
 * Before: an unknown goldBucket matched nothing on the index while the SQL
 * fallback dropped it (the whole corpus), an unknown sourceType gave an empty
 * table, and completeness=unknown -- offered by the /bgcs column filter -- was
 * ignored by both, which is the whole corpus again.
 *
 * `@/lib/prisma` and the browse client are mocked: vitest has no test database,
 * and an unmocked prisma reaches the live one.
 */

const { queryRaw, executeRaw, search, aggregate, count, open, checkRateLimit, state } = vi.hoisted(() => ({
  checkRateLimit: vi.fn(async () => ({ success: true, limit: 20, remaining: 4, reset: 0 })),
  queryRaw: vi.fn(),
  executeRaw: vi.fn(async () => 0),
  search: vi.fn(),
  aggregate: vi.fn(),
  count: vi.fn(),
  open: vi.fn(),
  state: { browse: true },
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    $queryRaw: queryRaw,
    $queryRawUnsafe: queryRaw,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ $queryRaw: queryRaw, $executeRawUnsafe: executeRaw }),
  },
  prisma: { $queryRaw: queryRaw, $queryRawUnsafe: queryRaw },
}));

vi.mock('@/lib/cache', async (orig) => ({
  ...(await orig<typeof import('@/lib/cache')>()),
  getOrSetCache: async (_k: string, fetcher: () => Promise<unknown>) => fetcher(),
}));

vi.mock('@/lib/opensearch/known-cluster-decorations', () => ({
  withKnownClusterHits: async <T,>(rows: T[]) => rows,
}));

vi.mock('@/lib/opensearch/browse-client', async (orig) => {
  const actual = await orig<typeof import('@/lib/opensearch/browse-client')>();
  const unexpected = async () => { throw new Error('not expected at offset 0'); };
  return {
    ...actual,
    isBrowseSearchEnabled: () => state.browse,
    searchBrowseIndex: search,
    aggregateBrowseIndex: aggregate,
    countBrowseIndex: unexpected,
    sortKeysBrowseIndex: unexpected,
    searchBrowseIndexWithBody: unexpected,
  };
});

vi.mock('@/lib/export/browse-export', () => ({
  countBrowseExport: count,
  openBrowseExport: open,
}));

vi.mock('@/lib/rate-limit', async (orig) => ({
  ...(await orig<typeof import('@/lib/rate-limit')>()),
  exportRateLimit: { getRemaining: async () => ({ remaining: 5, reset: Date.now() + 600_000 }) },
  checkRateLimit,
  getClientIp: () => '127.0.0.1',
}));

beforeEach(() => {
  queryRaw.mockReset().mockResolvedValue([]);
  executeRaw.mockClear();
  search.mockReset().mockResolvedValue({ total: 0, documents: [] });
  aggregate.mockReset().mockResolvedValue({ hits: { total: { value: 0 } }, aggregations: {} });
  count.mockReset().mockResolvedValue(3);
  checkRateLimit.mockClear();
  open.mockReset().mockRejectedValue(new Error('the download body is not under test'));
  state.browse = true;
});

const REFUSED: Array<[param: string, value: string]> = [
  ['goldBucket', 'not-a-bucket'],
  ['sourceType', 'bogus'],
  ['completeness', 'unknown'],
  ['completeness', 'bogus'],
];

const VALID: Array<[param: string, value: string]> = [
  ['goldBucket', 'soil-terrestrial'],
  ['sourceType', 'MAG'],
  ['completeness', 'complete'],
  ['completeness', 'partial'],
];

const query = (param: string, value: string) => `${param}=${encodeURIComponent(value)}`;

type Body = { success?: boolean; code?: string; error?: string; message?: string; rejected?: string[] };

const expectRefusal = (status: number, body: Body, value: string) => {
  expect(status).toBe(400);
  expect(body.success).toBe(false);
  // The client tells a filter refusal from other 400s by this code.
  expect(body.code).toBe('filter_refused');
  expect(body.rejected).toEqual([value]);
  expect(body.message).toContain(value);
  expect(body.error).toBe(body.message);
};

describe('/api/bgcs', () => {
  const call = async (q: string) => {
    const { GET } = await import('./route');
    const res = await GET(new Request(`http://localhost/api/bgcs?${q}`));
    return { status: res.status, body: await res.json() as Body };
  };

  describe.each([['OpenSearch', true], ['PostgreSQL', false]])('%s', (_label, browse) => {
    it.each(REFUSED)('refuses %s=%s before either backend', async (param, value) => {
      state.browse = browse;
      const { status, body } = await call(query(param, value));
      expectRefusal(status, body, value);
      expect(search).not.toHaveBeenCalled();
      expect(queryRaw).not.toHaveBeenCalled();
    });

    it.each(VALID)('passes %s=%s to the backend', async (param, value) => {
      state.browse = browse;
      const { status } = await call(query(param, value));
      expect(status).toBe(200);
      if (browse) {
        expect(search).toHaveBeenCalled();
        expect(queryRaw).not.toHaveBeenCalled();
      } else {
        expect(queryRaw).toHaveBeenCalled();
      }
    });
  });

  it('names exactly the source types it does not know', async () => {
    const { status, body } = await call('sourceType=MAG&sourceType=bogus');
    expect(status).toBe(400);
    expect(body.rejected).toEqual(['bogus']);
  });

  it.each([['OpenSearch', true], ['PostgreSQL', false]])('%s reads padded and blank values as both backends do', async (_label, browse) => {
    // Both backends trim sourceType and goldBucket and skip a blank, and skip a
    // blank completeness: what they always honoured is not refused now.
    state.browse = browse;
    const { status } = await call('sourceType=%20MAG&sourceType=&goldBucket=%20soil-terrestrial&completeness=');
    expect(status).toBe(200);
    if (browse) expect(search).toHaveBeenCalled();
    else expect(queryRaw).toHaveBeenCalled();
  });

  it('refuses a padded completeness, which neither backend ever matched', async () => {
    const { status, body } = await call('completeness=%20complete');
    expectRefusal(status, body, ' complete');
  });
});

describe.each([
  ['distribution', 'variant=gold_level_1'],
  ['taxonomy-composition', 'rank=phylum'],
] as const)('/api/bgcs/%s', (route, base) => {
  const call = async (q: string) => {
    const { GET } = route === 'distribution'
      ? await import('./distribution/route')
      : await import('./taxonomy-composition/route');
    const { NextRequest } = await import('next/server');
    const res = await GET(new NextRequest(`http://localhost/api/bgcs/${route}?${base}&${q}`));
    return { status: res.status, body: await res.json() as Body };
  };

  it.each(REFUSED)('refuses %s=%s', async (param, value) => {
    const { status, body } = await call(query(param, value));
    expectRefusal(status, body, value);
    expect(aggregate).not.toHaveBeenCalled();
  });

  it.each(REFUSED)('refuses %s=%s with the index off, too', async (param, value) => {
    // Otherwise the chart falls back to the corpus-wide snapshot beside a 400 table.
    state.browse = false;
    const { status, body } = await call(query(param, value));
    expectRefusal(status, body, value);
  });

  it.each(VALID)('passes %s=%s to the index', async (param, value) => {
    const { status } = await call(query(param, value));
    expect(status).not.toBe(400);
    expect(aggregate).toHaveBeenCalled();
  });
});

describe('/api/bgcs/export', () => {
  const call = async (q: string) => {
    const { GET } = await import('./export/route');
    return GET(new Request(`http://localhost/api/bgcs/export?format=csv&${q}`));
  };

  it.each(REFUSED)('the check refuses %s=%s with ok:false and the reason', async (param, value) => {
    const res = await call(`check=1&${query(param, value)}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; reason?: string };
    expect(body.ok).toBe(false);
    expect(body.reason).toContain(value);
    expect(count).not.toHaveBeenCalled();
  });

  it.each(REFUSED)('the download refuses %s=%s with a 409, before the rate limit', async (param, value) => {
    const res = await call(query(param, value));
    expect(res.status).toBe(409);
    expect(await res.text()).toContain(value);
    expect(open).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it.each(REFUSED)('a HEAD refuses %s=%s too', async (param, value) => {
    const { GET } = await import('./export/route');
    const res = await GET(new Request(`http://localhost/api/bgcs/export?format=csv&${query(param, value)}`, { method: 'HEAD' }));
    expect(res.status).toBe(409);
  });

  it.each(VALID)('the check passes %s=%s to the index', async (param, value) => {
    const res = await call(`check=1&${query(param, value)}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, total: 3 });
    expect(count).toHaveBeenCalled();
  });
});
