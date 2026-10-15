import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Cache-key behaviour of the three statistics routes, against an in-memory
 * Redis behind the real getOrSetCache/invalidateCache and a fake Prisma.
 */

/** Redis glob semantics: `*` any run, `?` one char, `[...]` a class. */
function redisGlobToRegExp(pattern: string): RegExp {
  let out = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '*') out += '.*';
    else if (ch === '?') out += '.';
    else if (ch === '[') {
      const close = pattern.indexOf(']', i);
      out += pattern.slice(i, close + 1);
      i = close;
    } else out += ch.replace(/[.+^${}()|\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

const { store, queryRaw } = vi.hoisted(() => ({
  store: new Map<string, string>(),
  queryRaw: vi.fn(),
}));

// Enough of a Redis to run the real getOrSetCache and invalidateCache. Glob
// semantics are assumed (scan uses redisGlobToRegExp); STATS_CACHE_PATTERNS
// were checked against a real `SCAN MATCH` by hand.
vi.mock('@/lib/redis-client', () => ({
  default: {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    },
    scan: async (_cursor: string, _match: 'MATCH', pattern: string) => {
      const re = redisGlobToRegExp(pattern);
      return ['0', [...store.keys()].filter((key) => re.test(key))] as [string, string[]];
    },
    del: async (...del: string[]) => {
      let n = 0;
      for (const key of del) if (store.delete(key)) n += 1;
      return n;
    },
  },
}));

vi.mock('@/lib/prisma', () => ({ default: { $queryRaw: queryRaw } }));

const { GET: statisticsGET } = await import('@/app/api/statistics/route');
const { GET: samplesGET } = await import('@/app/api/statistics/samples/route');
const { GET: hierarchyGET } = await import('@/app/api/statistics/samples/hierarchy/route');
const {
  STATS_CACHE_PATTERNS,
  STATS_WARM_PATHS,
  STATS_SAMPLES_NAMESPACE,
  STATS_SAMPLES_HIERARCHY_NAMESPACE,
} = await import('@/lib/stats-cache');
const { serializeFilterGroup } = await import('@/lib/filters/types');
const { invalidateCache } = await import('@/lib/cache');
const {
  buildOuterFilters,
  parseSampleFilters,
  SOURCE_TYPES,
} = await import('@/lib/api/samples-query');
type SampleFilterInputs = Awaited<ReturnType<typeof parseSampleFilters>>;

const ORIGIN = 'http://localhost:3000';

type RouteHandler = (request: NextRequest) => Promise<Response>;

beforeEach(() => {
  store.clear();
  queryRaw.mockReset().mockResolvedValue([]);
});

async function call(
  handler: RouteHandler,
  path: string,
): Promise<Record<string, unknown>> {
  const response = await handler(new NextRequest(`${ORIGIN}${path}`));
  return (await response.json()) as Record<string, unknown>;
}

const keys = () => [...store.keys()];

/** Every key a handler writes for one query string, with the store cleared first. */
async function keyFor(
  handler: RouteHandler,
  path: string,
): Promise<string> {
  store.clear();
  await call(handler, path);
  const written = keys();
  expect(written).toHaveLength(1);
  return written[0];
}

describe('/api/statistics — repeated parameters must not collapse', () => {
  const totals = (totalSamples: number) => [
    {
      total_samples: totalSamples,
      total_assemblies: 0,
      total_bgcs: 0,
      total_complete_bgcs: 0,
      total_gcfs: 0,
      total_metagenome_samples: 0,
      total_metagenome_assemblies: 0,
      total_genomes: 0,
    },
  ];
  const samplesIn = (body: Record<string, unknown>) =>
    (body.data as { totalSamples: number }).totalSamples;

  const TRIPLE = '/api/statistics?sourceType=isolate&sourceType=MAG&sourceType=SAG';
  const SAG_ONLY = '/api/statistics?sourceType=SAG';

  it('keeps a single-type request apart from the key /genome-collections reads', async () => {
    queryRaw.mockResolvedValueOnce(totals(168));
    expect(samplesIn(await call(statisticsGET, SAG_ONLY))).toBe(168);

    queryRaw.mockResolvedValueOnce(totals(791_144));
    expect(samplesIn(await call(statisticsGET, TRIPLE))).toBe(791_144);

    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect(new Set(keys()).size).toBe(2);
  });

  it('does not serve the warm path\'s three-type totals to a single-type request', async () => {
    queryRaw.mockResolvedValueOnce(totals(791_144));
    expect(samplesIn(await call(statisticsGET, TRIPLE))).toBe(791_144);

    queryRaw.mockResolvedValueOnce(totals(168));
    expect(samplesIn(await call(statisticsGET, SAG_ONLY))).toBe(168);

    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect(new Set(keys()).size).toBe(2);
  });

  it('reuses one entry for the same set of source types in either order', async () => {
    const a = await keyFor(statisticsGET, '/api/statistics?sourceType=isolate&sourceType=MAG');
    const b = await keyFor(statisticsGET, '/api/statistics?sourceType=MAG&sourceType=isolate');
    expect(a).toBe(b);
  });

  it('ignores a parameter the route does not read', async () => {
    const plain = await keyFor(statisticsGET, '/api/statistics?sourceType=MAG');
    const junk = await keyFor(statisticsGET, '/api/statistics?sourceType=MAG&utm_source=twitter&foo=1');
    expect(junk).toBe(plain);
  });
});

describe('/api/statistics/samples — repeated parameters must not collapse', () => {
  it('keys a two-source-type request apart from a single-source-type one', async () => {
    const multi = await keyFor(
      samplesGET,
      '/api/statistics/samples?sourceType=isolate&sourceType=MAG',
    );
    const single = await keyFor(samplesGET, '/api/statistics/samples?sourceType=MAG');
    expect(multi).not.toBe(single);
  });

  it('reuses one entry for the same set of source types in either order', async () => {
    const a = await keyFor(samplesGET, '/api/statistics/samples?sourceType=isolate&sourceType=MAG');
    const b = await keyFor(samplesGET, '/api/statistics/samples?sourceType=MAG&sourceType=isolate');
    expect(a).toBe(b);
  });

  it('is independent of parameter order', async () => {
    const a = await keyFor(samplesGET, '/api/statistics/samples?biome=soil&groupBy=feature&limit=5');
    const b = await keyFor(samplesGET, '/api/statistics/samples?limit=5&groupBy=feature&biome=soil');
    expect(a).toBe(b);
  });

  it('ignores parameters the route does not read', async () => {
    const plain = await keyFor(samplesGET, '/api/statistics/samples?groupBy=biome');
    const junk = await keyFor(samplesGET, '/api/statistics/samples?groupBy=biome&cacheBust=93&utm_medium=x');
    expect(junk).toBe(plain);
  });

  it('collapses an unrecognised groupBy onto the biome default it actually runs', async () => {
    const fallback = await keyFor(samplesGET, '/api/statistics/samples?groupBy=not-a-column');
    const biome = await keyFor(samplesGET, '/api/statistics/samples?groupBy=biome');
    expect(fallback).toBe(biome);
  });

  it('ignores the client-side ids inside advancedFilters', async () => {
    // The ids are browser-minted UUIDs the server never reads. `bgcs`, not `ph`:
    // an unhonourable field 400s before any key is minted.
    const group = (groupId: string, conditionId: string) => ({
      id: groupId,
      operator: 'AND' as const,
      conditions: [{ id: conditionId, field: 'bgcs', operator: 'gte' as const, value: 7 }],
      groups: [],
    });
    const one = await keyFor(
      samplesGET,
      `/api/statistics/samples?advancedFilters=${serializeFilterGroup(group('g-1', 'c-1'))}`,
    );
    const two = await keyFor(
      samplesGET,
      `/api/statistics/samples?advancedFilters=${serializeFilterGroup(group('g-2', 'c-2'))}`,
    );
    expect(two).toBe(one);
  });

  it('still separates advancedFilters that differ in substance', async () => {
    const group = (value: number) => ({
      id: 'g',
      operator: 'AND' as const,
      conditions: [{ id: 'c', field: 'bgcs', operator: 'gte' as const, value }],
      groups: [],
    });
    const seven = await keyFor(
      samplesGET,
      `/api/statistics/samples?advancedFilters=${serializeFilterGroup(group(7))}`,
    );
    const eight = await keyFor(
      samplesGET,
      `/api/statistics/samples?advancedFilters=${serializeFilterGroup(group(8))}`,
    );
    expect(eight).not.toBe(seven);
  });

  it('treats an advancedFilters group with no rules as no advanced filter at all', async () => {
    // buildAdvancedWhere returns null for a ruleless group.
    const empty = serializeFilterGroup({ id: 'g', operator: 'AND', conditions: [], groups: [] });
    const withEmpty = await keyFor(samplesGET, `/api/statistics/samples?advancedFilters=${empty}`);
    const without = await keyFor(samplesGET, '/api/statistics/samples');
    expect(withEmpty).toBe(without);
  });
});

describe('/api/statistics/samples/hierarchy — repeated parameters must not collapse', () => {
  it('keys a two-source-type request apart from a single-source-type one', async () => {
    const multi = await keyFor(
      hierarchyGET,
      '/api/statistics/samples/hierarchy?sourceType=isolate&sourceType=MAG',
    );
    const single = await keyFor(hierarchyGET, '/api/statistics/samples/hierarchy?sourceType=MAG');
    expect(multi).not.toBe(single);
  });

  it('is independent of parameter order', async () => {
    const a = await keyFor(hierarchyGET, '/api/statistics/samples/hierarchy?biome=soil&host=human');
    const b = await keyFor(hierarchyGET, '/api/statistics/samples/hierarchy?host=human&biome=soil');
    expect(a).toBe(b);
  });

  it('ignores parameters the route does not read', async () => {
    const plain = await keyFor(hierarchyGET, '/api/statistics/samples/hierarchy?biome=soil');
    const junk = await keyFor(hierarchyGET, '/api/statistics/samples/hierarchy?biome=soil&page=4');
    expect(junk).toBe(plain);
  });

  it('keys under its own namespace, not the flat distribution one', async () => {
    // The two routes take the same filters and return different payloads, so
    // the namespace -- not an incidental difference in the inputs -- is what
    // has to keep them apart.
    const flat = await keyFor(samplesGET, '/api/statistics/samples?biome=soil');
    const nested = await keyFor(hierarchyGET, '/api/statistics/samples/hierarchy?biome=soil');

    expect(flat.startsWith(`${STATS_SAMPLES_NAMESPACE}:v`)).toBe(true);
    expect(nested.startsWith(`${STATS_SAMPLES_HIERARCHY_NAMESPACE}:v`)).toBe(true);
    expect(nested).not.toBe(flat);
  });
});

describe('refresh-time invalidation still reaches these keys', () => {
  async function bustAll(): Promise<number> {
    let deleted = 0;
    for (const pattern of STATS_CACHE_PATTERNS) {
      deleted += await invalidateCache(pattern);
    }
    return deleted;
  }

  it('busts every key the three routes write', async () => {
    store.clear();
    await call(statisticsGET, '/api/statistics');
    await call(statisticsGET, '/api/statistics?sourceType=isolate&sourceType=MAG&sourceType=SAG');
    await call(samplesGET, '/api/statistics/samples?groupBy=gold_level_2&limit=12');
    await call(hierarchyGET, '/api/statistics/samples/hierarchy?biome=soil');
    const written = keys();
    expect(written).toHaveLength(4);

    const deleted = await bustAll();

    expect(deleted).toBe(4);
    expect(keys(), `survived invalidation: ${keys().join(', ')}`).toEqual([]);
  });

  it('busts a real key for every in-scope warm path', async () => {
    // An unhandled warm path must be listed as out of scope, not silently skipped.
    const handlers: Record<string, RouteHandler> = {
      '/api/statistics': statisticsGET,
      '/api/statistics/samples': samplesGET,
      '/api/statistics/samples/hierarchy': hierarchyGET,
    };
    const OUT_OF_SCOPE = [
      '/api/statistics/gcfs',
      '/api/statistics/genomes/taxonomy-hierarchy',
      '/api/gcfs/stats',
    ];

    store.clear();
    let warmed = 0;
    for (const path of STATS_WARM_PATHS) {
      const route = path.split('?')[0];
      if (OUT_OF_SCOPE.includes(route)) continue;
      const handler = handlers[route];
      expect(handler, `warm path ${path} has no handler here and is not listed as out of scope`)
        .toBeDefined();
      await call(handler, path);
      warmed += 1;
    }
    expect(warmed).toBe(STATS_WARM_PATHS.length - OUT_OF_SCOPE.length);
    expect(keys().length).toBe(warmed);

    const deleted = await bustAll();
    expect(deleted).toBe(warmed);
  });
});

describe('every filter input is pinned into the key', () => {
  // A filter missing from the key makes two different answers share an entry.
  // The completeness check makes this table self-enforcing.
  const CASES: Array<{
    field: keyof SampleFilterInputs;
    a: string;
    b: string;
  }> = [
    { field: 'id', a: 'id=aaa', b: 'id=bbb' },
    { field: 'search', a: 'search=soil', b: 'search=ocean' },
    { field: 'environment', a: 'environment=marine', b: 'environment=forest' },
    { field: 'biome', a: 'biome=soil', b: 'biome=marine' },
    { field: 'goldEcosystem', a: 'goldEcosystem=Environmental', b: 'goldEcosystem=Engineered' },
    { field: 'goldBucket', a: 'goldBucket=marine', b: 'goldBucket=freshwater' },
    { field: 'environmentText', a: 'environmentText=a', b: 'environmentText=b' },
    { field: 'material', a: 'material=water', b: 'material=sediment' },
    { field: 'feature', a: 'feature=lake', b: 'feature=river' },
    { field: 'host', a: 'host=human', b: 'host=mouse' },
    { field: 'latMin', a: 'latMin=10', b: 'latMin=20' },
    { field: 'latMax', a: 'latMax=10', b: 'latMax=20' },
    { field: 'lonMin', a: 'lonMin=10', b: 'lonMin=20' },
    { field: 'lonMax', a: 'lonMax=10', b: 'lonMax=20' },
    { field: 'dataSource', a: 'dataSource=mgnify', b: 'dataSource=spire' },
    { field: 'study', a: 'study=Tara', b: 'study=Malaspina' },
    { field: 'studyKey', a: 'studyKey=study-a', b: 'studyKey=study-b' },
    { field: 'assembliesMin', a: 'assembliesMin=1', b: 'assembliesMin=2' },
    { field: 'assembliesMax', a: 'assembliesMax=1', b: 'assembliesMax=2' },
    { field: 'bgcsMin', a: 'bgcsMin=1', b: 'bgcsMin=2' },
    { field: 'bgcsMax', a: 'bgcsMax=1', b: 'bgcsMax=2' },
    { field: 'gcfsMin', a: 'gcfsMin=1', b: 'gcfsMin=2' },
    { field: 'gcfsMax', a: 'gcfsMax=1', b: 'gcfsMax=2' },
    { field: 'completenessMin', a: 'completenessMin=90', b: 'completenessMin=95' },
    { field: 'completenessMax', a: 'completenessMax=90', b: 'completenessMax=95' },
    { field: 'contaminationMin', a: 'contaminationMin=1', b: 'contaminationMin=2' },
    { field: 'contaminationMax', a: 'contaminationMax=1', b: 'contaminationMax=2' },
    { field: 'genomeQuality', a: 'genomeQuality=high', b: 'genomeQuality=medium' },
    { field: 'sourceTypes', a: 'sourceType=MAG', b: 'sourceType=isolate' },
  ];

  it('treats a repeated identical source type as one', async () => {
    // `ARRAY['MAG','MAG']` equals ARRAY['MAG'] in SQL, so losing the dedupe would go unnoticed.
    const twice = await keyFor(samplesGET, '/api/statistics/samples?sourceType=MAG&sourceType=MAG');
    const once = await keyFor(samplesGET, '/api/statistics/samples?sourceType=MAG');
    expect(twice).toBe(once);
  });

  it('covers every field of SampleFilterInputs', () => {
    const fields = Object.keys(parseSampleFilters(new URLSearchParams())).sort();
    expect(CASES.map((c) => c.field).sort()).toEqual(fields);
  });

  for (const route of [
    { name: '/api/statistics/samples', handler: samplesGET, base: '/api/statistics/samples' },
    {
      name: '/api/statistics/samples/hierarchy',
      handler: hierarchyGET,
      base: '/api/statistics/samples/hierarchy',
    },
  ]) {
    describe(route.name, () => {
      for (const { field, a, b } of CASES) {
        it(`keys on ${String(field)}`, async () => {
          const none = await keyFor(route.handler, route.base);
          const withA = await keyFor(route.handler, `${route.base}?${a}`);
          const withB = await keyFor(route.handler, `${route.base}?${b}`);
          expect(withA).not.toBe(none);
          expect(withA).not.toBe(withB);
          expect(withB).not.toBe(none);
        });
      }
    });
  }
});

describe('the cache key and the SQL are parsed the same way', () => {
  // e.g. a present-but-empty `?dataSource=` next to `?dataSourceId=`.
  const dataSourceFragments = (qs: string) =>
    buildOuterFilters(new URLSearchParams(qs))
      .map((fragment) => fragment.sql)
      .filter((sql) => sql.includes('data_source'));

  it('applies no data-source filter for ?dataSource=&dataSourceId=abc', () => {
    expect(dataSourceFragments('dataSource=&dataSourceId=abc')).toEqual([]);
    expect(dataSourceFragments('dataSourceId=abc')).toHaveLength(1);
    expect(dataSourceFragments('dataSource=abc')).toHaveLength(1);
  });

  it('keys ?dataSource=&dataSourceId=abc as the unfiltered request it runs as', async () => {
    const unfiltered = await keyFor(samplesGET, '/api/statistics/samples');
    const emptyThenId = await keyFor(
      samplesGET,
      '/api/statistics/samples?dataSource=&dataSourceId=abc',
    );
    const filtered = await keyFor(samplesGET, '/api/statistics/samples?dataSource=abc');

    expect(emptyThenId).toBe(unfiltered);
    expect(filtered).not.toBe(unfiltered);
  });

  it('mints no key at all for an unrecognised goldBucket, because it is refused', async () => {
    // An unrecognised bucket must 400, not collapse onto the unfiltered key.
    const response = await samplesGET(
      new NextRequest(`${ORIGIN}/api/statistics/samples?goldBucket=not-a-bucket`),
    );
    expect(response.status).toBe(400);
    expect(keys()).toHaveLength(0);
  });

  it('still gives two real buckets two different keys', async () => {
    const unfiltered = await keyFor(samplesGET, '/api/statistics/samples');
    const marine = await keyFor(samplesGET, '/api/statistics/samples?goldBucket=marine');
    const soil = await keyFor(samplesGET, '/api/statistics/samples?goldBucket=soil-terrestrial');

    expect(marine).not.toBe(unfiltered);
    expect(soil).not.toBe(marine);
  });
});

describe('/api/statistics/samples — limit', () => {
  const limitOf = async (qs: string) => {
    const body = await call(samplesGET, `/api/statistics/samples${qs}`);
    return (body.data as { meta: { limit: number } }).meta.limit;
  };

  it('clamps out-of-range and unparseable limits', async () => {
    expect(await limitOf('?limit=0')).toBe(1);
    expect(await limitOf('?limit=-5')).toBe(1);
    expect(await limitOf('?limit=100000')).toBe(100);
    expect(await limitOf('?limit=abc')).toBe(20);
    expect(await limitOf('?limit=15')).toBe(15);
  });

  it('collapses every over-large limit onto one key', async () => {
    const a = await keyFor(samplesGET, '/api/statistics/samples?limit=100000');
    const b = await keyFor(samplesGET, '/api/statistics/samples?limit=999999');
    const max = await keyFor(samplesGET, '/api/statistics/samples?limit=100');
    expect(a).toBe(max);
    expect(b).toBe(max);
  });

  it('still keys distinct in-range limits apart', async () => {
    const ten = await keyFor(samplesGET, '/api/statistics/samples?limit=10');
    const twenty = await keyFor(samplesGET, '/api/statistics/samples?limit=20');
    expect(ten).not.toBe(twenty);
  });
});

describe('/api/statistics — unknown source types are rejected', () => {
  it('answers 400 and caches nothing', async () => {
    store.clear();
    const response = await statisticsGET(new NextRequest(`${ORIGIN}/api/statistics?sourceType=nope`));

    expect(response.status).toBe(400);
    expect(keys()).toEqual([]);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('rejects rather than dropping an unknown type mixed with a valid one', async () => {
    // Dropping it would file a different answer under the SAG key.
    const response = await statisticsGET(
      new NextRequest(`${ORIGIN}/api/statistics?sourceType=SAG&sourceType=typo`),
    );
    expect(response.status).toBe(400);
    expect(keys()).toEqual([]);
  });

  it('accepts every type the corpus actually has', async () => {
    for (const type of SOURCE_TYPES) {
      const response = await statisticsGET(
        new NextRequest(`${ORIGIN}/api/statistics?sourceType=${type}`),
      );
      expect(response.status, `${type} should be accepted`).toBe(200);
    }
  });
});
