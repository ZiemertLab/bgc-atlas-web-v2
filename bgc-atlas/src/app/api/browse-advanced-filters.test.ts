import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The eight GET routes that accept `?advancedFilters=`. A condition that can't
 * be honoured must be refused (400), never dropped: dropping widens the answer
 * at HTTP 200. Most of this file pins the SQL fallback (the index is mocked
 * off); the last block pins the index path. Both must refuse identically.
 */

const { store, queryRaw } = vi.hoisted(() => ({
  store: new Map<string, string>(),
  queryRaw: vi.fn(),
}));

vi.mock('@/lib/redis-client', () => ({
  default: {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => { store.set(key, value); return 'OK'; },
    scan: async () => ['0', []] as [string, string[]],
    del: async () => 0,
  },
}));
vi.mock('@/lib/prisma', () => ({ default: { $queryRaw: queryRaw } }));

// The SQL fallback is the path under test.
vi.mock('@/lib/opensearch/browse-client', () => ({
  isBrowseSearchEnabled: () => false,
  searchBrowseIndex: async () => { throw new Error('index disabled in this suite'); },
  aggregateBrowseIndex: async () => { throw new Error('index disabled in this suite'); },
}));

const { serializeFilterGroup } = await import('@/lib/filters/types');

type Handler = (request: Request) => Promise<Response>;

const ROUTES: Record<string, { path: string; load: () => Promise<{ GET: Handler }> }> = {
  bgcs: { path: '/api/bgcs', load: () => import('@/app/api/bgcs/route') as Promise<{ GET: Handler }> },
  gcfs: { path: '/api/gcfs', load: () => import('@/app/api/gcfs/route') as Promise<{ GET: Handler }> },
  studies: { path: '/api/studies', load: () => import('@/app/api/studies/route') as Promise<{ GET: Handler }> },
  samples: { path: '/api/samples', load: () => import('@/app/api/samples/route') as Promise<{ GET: Handler }> },
  assemblies: { path: '/api/assemblies', load: () => import('@/app/api/assemblies/route') as Promise<{ GET: Handler }> },
  map: { path: '/api/samples/map', load: () => import('@/app/api/samples/map/route') as Promise<{ GET: Handler }> },
  stats: { path: '/api/statistics/samples', load: () => import('@/app/api/statistics/samples/route') as Promise<{ GET: Handler }> },
  hierarchy: { path: '/api/statistics/samples/hierarchy', load: () => import('@/app/api/statistics/samples/hierarchy/route') as Promise<{ GET: Handler }> },
};

const GOOD: Record<keyof typeof ROUTES, { field: string; operator: string; value: unknown }> = {
  bgcs: { field: 'length', operator: 'gt', value: 5000 },
  gcfs: { field: 'memberBgcCount', operator: 'gt', value: 10 },
  studies: { field: 'totalBgcs', operator: 'gt', value: 10 },
  samples: { field: 'bgcs', operator: 'gt', value: 10 },
  assemblies: { field: 'bgcs', operator: 'gt', value: 10 },
  map: { field: 'bgcs', operator: 'gt', value: 10 },
  stats: { field: 'bgcs', operator: 'gt', value: 10 },
  hierarchy: { field: 'bgcs', operator: 'gt', value: 10 },
};

/**
 * A text field per route for the half-built case: an empty numeric box could
 * become `column = 0` (Number('') is finite) and make that assertion vacuous.
 */
const GOOD_TEXT: Record<keyof typeof ROUTES, string> = {
  bgcs: 'productType',
  gcfs: 'productType',
  studies: 'title',
  samples: 'biome',
  assemblies: 'biome',
  map: 'biome',
  stats: 'biome',
  hierarchy: 'biome',
};

const encode = (conditions: unknown[]) =>
  serializeFilterGroup({ id: 'g', operator: 'AND', conditions, groups: [] } as never);

const issuedSql = () => queryRaw.mock.calls.map(([q]) => {
  const stmt = q as { sql?: string; strings?: string[]; values?: unknown[] };
  return { text: stmt.sql ?? (stmt.strings ?? []).join('?'), values: stmt.values ?? [] };
});

const call = async (route: keyof typeof ROUTES, query: string) => {
  const { GET } = await ROUTES[route].load();
  const res = await GET(new Request(`http://localhost${ROUTES[route].path}${query}`));
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* not JSON */ }
  return { status: res.status, json, text };
};

beforeEach(() => {
  store.clear();
  queryRaw.mockReset().mockResolvedValue([]);
});

const names = Object.keys(ROUTES) as (keyof typeof ROUTES)[];

describe.each(names)('%s refuses an advancedFilters condition it cannot honour', (route) => {
  it('400s on an unknown field instead of answering the wider question', async () => {
    const bad = encode([{ id: 'c1', field: 'no_such_field', operator: 'contains', value: 'soil' }]);
    const { status, json } = await call(route, `?advancedFilters=${bad}`);
    expect(status).toBe(400);
    expect(String(json.message)).toContain('no_such_field');
    expect(String(json.message)).toContain('broader question');
    // Both keys carry it: each browse page reads whichever one it renders.
    expect(json.error).toBe(json.message);
    // Needs the route's field catalog; otherwise every refusal degrades to "unusable value".
    expect(json.rejected).toEqual([
      expect.objectContaining({ field: 'no_such_field', reason: 'unknown_field' }),
    ]);
  });

  it('reports every bad condition in one reply, not one per round trip', async () => {
    const bad = encode([
      { id: 'c1', field: 'no_such_field', operator: 'contains', value: 'soil' },
      { id: 'c2', field: 'another_typo', operator: 'contains', value: 'marine' },
    ]);
    const { status, json } = await call(route, `?advancedFilters=${bad}`);
    expect(status).toBe(400);
    expect(String(json.message)).toContain('no_such_field');
    expect(String(json.message)).toContain('another_typo');
  });

  it('still answers a condition it CAN honour', async () => {
    const good = encode([{ id: 'c1', ...GOOD[route] }]);
    const { status } = await call(route, `?advancedFilters=${good}`);
    expect(status).toBe(200);
    expect(queryRaw).toHaveBeenCalled();
  });

  it('says the OPERATOR was wrong when the field itself is real', async () => {
    // Pins that the route handed the builder its own catalog.
    const bad = encode([{ id: 'c1', field: GOOD[route].field, operator: 'contains', value: 'x' }]);
    const { status, json } = await call(route, `?advancedFilters=${bad}`);
    expect(status).toBe(400);
    expect(json.rejected).toEqual([
      expect.objectContaining({ field: GOOD[route].field, reason: 'unsupported_operator' }),
    ]);
    expect(String(json.message)).toContain('supported:');
  });

  it('still answers a half-built condition, which the builder emits mid-edit', async () => {
    // Beside a real one: a group whose only condition is blank never reaches the branch.
    const halfBuilt = encode([
      { id: 'c1', field: GOOD_TEXT[route], operator: 'contains', value: '' },
      { id: 'c2', ...GOOD[route] },
    ]);
    const { status } = await call(route, `?advancedFilters=${halfBuilt}`);
    expect(status).toBe(200);
  });

  it('drops an empty NUMERIC box too, rather than running it as `= 0`', async () => {
    const halfBuilt = encode([
      { id: 'c1', field: GOOD[route].field, operator: 'equals', value: '' },
      { id: 'c2', field: GOOD_TEXT[route], operator: 'contains', value: 'soil' },
    ]);
    const withBlank = await call(route, `?advancedFilters=${halfBuilt}`);
    expect(withBlank.status).toBe(200);
    const sqlWithBlank = issuedSql();

    // Compare whole queries: "no 0 was bound" fails because limits/offsets bind 0 too.
    queryRaw.mockClear();
    const withoutBlank = encode([{ id: 'c2', field: GOOD_TEXT[route], operator: 'contains', value: 'soil' }]);
    const { status } = await call(route, `?advancedFilters=${withoutBlank}`);
    expect(status).toBe(200);
    expect(sqlWithBlank).toEqual(issuedSql());
  });

  it('answers the realistic stale-link shape: one honoured condition beside a refused one', async () => {
    const mixed = encode([
      { id: 'c1', ...GOOD[route] },
      { id: 'c2', field: 'no_such_field', operator: 'contains', value: 'soil' },
    ]);
    const { status, json } = await call(route, `?advancedFilters=${mixed}`);
    expect(status).toBe(400);
    expect(json.rejected).toEqual([
      expect.objectContaining({ field: 'no_such_field', reason: 'unknown_field' }),
    ]);
  });
});

/**
 * Every option the filter builder offers must be answerable, or an ordinary
 * click becomes a 400.
 */
const CATALOGS = {
  bgcs: 'bgcFilterFields',
  gcfs: 'gcfFilterFields',
  studies: 'studyFilterFields',
  samples: 'sampleFilterFields',
} as const;

const sampleValue = (
  field: { type: string; options?: { value: string }[] },
  operator: string,
): unknown => {
  if (field.options?.length) return field.options.map((o) => o.value)[0];
  if (field.type === 'number') return operator === 'between' ? [1, 2] : 1;
  return 'x';
};

describe.each(Object.keys(CATALOGS) as (keyof typeof CATALOGS)[])(
  '%s answers every field+operator its own catalog offers',
  (route) => {
    it('has no option the builder offers and the query cannot honour', async () => {
      const defs = await import('@/lib/filters/field-definitions');
      const fields = defs[CATALOGS[route]];
      const refused: string[] = [];
      for (const field of fields) {
        for (const operator of field.allowedOperators ?? []) {
          for (const value of (field.options?.length
            ? field.options.map((o) => o.value)
            : [sampleValue(field, operator)])) {
            const encoded = encode([{ id: 'c1', field: field.id, operator, value }]);
            const { status, json } = await call(route, `?advancedFilters=${encoded}`);
            if (status !== 200) refused.push(`${field.id} ${operator} ${JSON.stringify(value)}: ${json.message}`);
          }
        }
      }
      expect(refused).toEqual([]);
    });
  },
);

describe.each(names)('%s refuses a payload it cannot read', (route) => {
  it('400s on a truncated payload instead of dropping the whole filter', async () => {
    // If deserializeFilterGroup returned null on a decode failure, the request
    // would run with no advanced filter at all.
    const whole = encode([{ id: 'c1', ...GOOD[route] }]);
    const truncated = whole.slice(0, Math.floor(whole.length * 0.6));
    const { status, json } = await call(route, `?advancedFilters=${truncated}`);
    expect(status).toBe(400);
    expect(String(json.message)).toMatch(/truncated|not a filter group/i);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('400s on valid base64 that is not a filter group at all', async () => {
    const notAGroup = encodeURIComponent(Buffer.from(JSON.stringify({ hello: 1 })).toString('base64'));
    const { status } = await call(route, `?advancedFilters=${notAGroup}`);
    expect(status).toBe(400);
  });

  it('400s on a group-shaped object whose `conditions` is not an array', async () => {
    // `groups` is valid, so only `conditions` would blow up later, as a 500.
    const wrong = encodeURIComponent(
      Buffer.from(JSON.stringify({ id: 'g', operator: 'AND', conditions: 'nope', groups: [] })).toString('base64'),
    );
    const { status, json } = await call(route, `?advancedFilters=${wrong}`);
    expect(status).toBe(400);
    expect(String(json.message)).toMatch(/not a filter group/i);
  });

  it('400s when a NESTED group is malformed, not just the outer one', async () => {
    const nested = encodeURIComponent(Buffer.from(JSON.stringify({
      id: 'g', operator: 'AND', conditions: [], groups: [{ id: 'g2', operator: 'OR' }],
    })).toString('base64'));
    expect((await call(route, `?advancedFilters=${nested}`)).status).toBe(400);
  });

  it('still treats an ABSENT payload as absent, not as unreadable', async () => {
    expect((await call(route, '')).status).toBe(200);
    expect((await call(route, '?advancedFilters=')).status).toBe(200);
  });
});

/** Prisma messages carry SQL and bound values, so the body must not echo them. */
describe.each(['bgcs', 'gcfs'] as const)('%s does not echo its exception into the body', (route) => {
  it('answers a database failure with an authored sentence', async () => {
    queryRaw.mockRejectedValue(new Error(
      'Invalid `prisma.$queryRaw()` invocation: SELECT * FROM bgcs WHERE assembly = $1 -- 0e6f-secret',
    ));
    const { status, json } = await call(route, '');
    expect(status).toBe(500);
    const body = JSON.stringify(json);
    expect(body).not.toContain('prisma');
    expect(body).not.toContain('SELECT');
    expect(body).not.toContain('secret');
  });
});

/**
 * The refusal is decided by the resolver, not the catalog: /api/gcfs honours
 * `avgDistance` as an alias though no catalog lists it.
 */
describe('a field the resolver honours but the catalog omits still runs', () => {
  it('answers /api/gcfs?advancedFilters=avgDistance, which is in no catalog', async () => {
    const defs = await import('@/lib/filters/field-definitions');
    expect(defs.gcfFilterFields.some((f) => f.id === 'avgDistance')).toBe(false);
    const alias = encode([{ id: 'c1', field: 'avgDistance', operator: 'gt', value: 0.4 }]);
    const { status, json } = await call('gcfs', `?advancedFilters=${alias}`);
    expect(status).toBe(200);
    expect(json.error).toBeUndefined();
  });
});

/**
 * An unknown ?sourceType= must be refused on every route (parseSampleFilters),
 * not answered as a legitimately empty table.
 */
const SOURCE_TYPE_ROUTES = ['samples', 'assemblies', 'map', 'stats', 'hierarchy'] as const;

describe.each(SOURCE_TYPE_ROUTES)('%s refuses an unknown ?sourceType=', (route) => {
  it('400s and lists the values that exist', async () => {
    const { status, json } = await call(route, '?sourceType=typo');
    expect(status).toBe(400);
    expect(String(json.message)).toContain('typo');
    expect(String(json.message)).toContain('isolate');
    expect(String(json.message)).toContain('metagenome');
  });

  it('400s even when a VALID type is sent alongside it', async () => {
    const { status, json } = await call(route, '?sourceType=MAG&sourceType=typo');
    expect(status).toBe(400);
    expect(String(json.message)).toContain('typo');
    expect(json.rejected).toEqual(['typo']);
  });

  it('still answers the four real types', async () => {
    const { status } = await call(route, '?sourceType=MAG&sourceType=isolate');
    expect(status).toBe(200);
  });
});

/**
 * Dropping an unknown bucket would answer every sample at 200 under a bogus
 * chip; the homepage map deep-links with this parameter.
 */
const GOLD_BUCKET_ROUTES = ['samples', 'assemblies', 'map', 'stats', 'hierarchy'] as const;

describe.each(GOLD_BUCKET_ROUTES)('%s refuses an unknown ?goldBucket=', (route) => {
  it('400s and lists the buckets that exist', async () => {
    const { status, json } = await call(route, '?goldBucket=marnie');
    expect(status).toBe(400);
    expect(String(json.message)).toContain('marnie');
    expect(String(json.message)).toContain('marine');
    expect(String(json.message)).toContain('soil-terrestrial');
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('answers every bucket it OFFERS in the error message', async () => {
    // Iterates GOLD_BUCKETS itself; a hand-written copy would hide drift.
    const { GOLD_BUCKETS } = await import('@/lib/api/samples-query');
    expect(GOLD_BUCKETS.length).toBeGreaterThan(0);
    for (const bucket of GOLD_BUCKETS) {
      const { status } = await call(route, `?goldBucket=${bucket}`);
      expect([bucket, status]).toEqual([bucket, 200]);
    }
  });

  it('still treats an absent or empty bucket as absent', async () => {
    expect((await call(route, '')).status).toBe(200);
    expect((await call(route, '?goldBucket=')).status).toBe(200);
  });
});

describe('/api/samples validates sourceType before the browse index answers', () => {
  it('refuses the typo even when the OpenSearch path would have served the request', async () => {
    // The index would answer ?sourceType=typo with zero hits.
    vi.resetModules();
    vi.doMock('@/lib/opensearch/browse-client', () => ({
      isBrowseSearchEnabled: () => true,
      searchBrowseIndex: async () => ({ documents: [], total: 0 }),
      aggregateBrowseIndex: async () => ({}),
    }));
    const mod = await import('@/app/api/samples/route') as { GET: Handler };
    const res = await mod.GET(new Request('http://localhost/api/samples?sourceType=typo'));
    expect(res.status).toBe(400);
    vi.doUnmock('@/lib/opensearch/browse-client');
    vi.resetModules();
  });
});

/**
 * The list routes fall back to PostgreSQL when the browse index fails. That is
 * right for an outage but wrong for a refused filter, which SQL re-refuses only
 * after a full-corpus scan (up to the 120s timeout). A generic failure must
 * still fall back.
 *
 * No URL carries `advancedFilters`: supportsBrowseSearch could skip the browse
 * branch and the assertions would pass vacuously on the SQL path. The refusal
 * is raised by searchBrowseIndex instead, which is asserted to be called.
 */
const BROWSE_ROUTES = ['bgcs', 'gcfs', 'samples'] as const;

describe.each(BROWSE_ROUTES)('%s: a refusal from the browse index is a 400, not a fallback', (route) => {
  // Mocked per block so the module-wide factory keeps other blocks on the SQL path.
  const browseSearch = vi.fn();

  // Built after resetModules: refusals are matched with `instanceof`, and a class
  // from a pre-reset module instance would miss and pass as a green fallback.
  const callWithIndex = async (makeFailure: () => Promise<unknown>) => {
    vi.resetModules();
    vi.doMock('@/lib/opensearch/browse-client', () => ({
      isBrowseSearchEnabled: () => true,
      searchBrowseIndex: browseSearch,
      aggregateBrowseIndex: browseSearch,
    }));
    browseSearch.mockReset().mockRejectedValue(await makeFailure());
    return call(route, '');
  };

  afterEach(() => {
    vi.doUnmock('@/lib/opensearch/browse-client');
    vi.resetModules();
  });

  it('400s with the repair text when the payload could not be read', async () => {
    const { status, json } = await callWithIndex(async () =>
      new (await import('@/lib/filters/types')).MalformedFilterPayloadError());
    expect(browseSearch).toHaveBeenCalled();
    expect(status).toBe(400);
    // A 5xx body is never rendered by the client.
    expect(String(json.message)).toMatch(/truncated|not a filter group/i);
    expect(String(json.message)).not.toMatch(/Unable to retrieve/i);
    expect(json.error).toBe(json.message);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('400s and names the offending field when a condition could not be honoured', async () => {
    const { status, json } = await callWithIndex(async () => {
      const { UnhonourableQueryError } = await import('@/lib/filters/unhonourable-query');
      return new UnhonourableQueryError([
        { field: 'productType', operator: 'not_contains', reason: 'unsupported_operator', supportedOperators: ['contains'] },
      ]);
    });
    expect(browseSearch).toHaveBeenCalled();
    expect(status).toBe(400);
    expect(json.rejected).toEqual([
      expect.objectContaining({ field: 'productType', reason: 'unsupported_operator' }),
    ]);
    expect(String(json.message)).toContain('productType');
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('still falls back to PostgreSQL when the index itself fails', async () => {
    const { status } = await callWithIndex(async () => new Error('opensearch exploded'));
    expect(browseSearch).toHaveBeenCalled();
    expect(status).toBe(200);
    expect(queryRaw).toHaveBeenCalled();
  });
});
