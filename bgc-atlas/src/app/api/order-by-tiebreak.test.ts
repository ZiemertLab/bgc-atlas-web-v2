import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Every browse list route must end its ORDER BY on a unique key, or a plan
 * change can serve a row on two pages. The OpenSearch path appends its id ASC,
 * so this also keeps both backends returning the same page for one URL.
 */

type Captured = { text: string; values: unknown[] };
const { captured } = vi.hoisted(() => ({ captured: [] as Captured[] }));

const capture = vi.fn(async (q: unknown) => {
  const sql = q as { text?: string; values?: unknown[] };
  if (sql?.text) captured.push({ text: sql.text, values: sql.values ?? [] });
  return [];
});

vi.mock('@/lib/prisma', () => ({
  default: { $queryRaw: capture, $queryRawUnsafe: capture },
  prisma: { $queryRaw: capture, $queryRawUnsafe: capture },
}));

// getOrSetCache would return a cached payload instead of running the fetcher.
vi.mock('@/lib/cache', async (orig) => {
  const actual = await orig<typeof import('@/lib/cache')>();
  return {
    ...actual,
    getOrSetCache: async (_k: string, fetcher: () => Promise<unknown>) => fetcher(),
    getOrSetCacheWithMetadata: async (_k: string, fetcher: () => Promise<unknown>) => ({
      data: await fetcher(), isHit: false,
    }),
  };
});

/**
 * The ORDER BY followed by LIMIT/OFFSET; inner aggregate ORDER BYs are not matched.
 */
function finalOrderBy(text: string): string {
  const m = text.match(/[\s\S]*\bORDER BY\b([\s\S]*?)\s+LIMIT\s+\$\d+\s+OFFSET\s+\$\d+\s*$/i);
  if (!m) throw new Error(`no paged ORDER BY found in:\n${text.slice(-400)}`);
  return m[1].replace(/\s+/g, ' ').trim();
}

async function orderByFor(entity: 'bgcs' | 'gcfs' | 'samples', qs: string): Promise<string> {
  captured.length = 0;
  const mod = entity === 'bgcs'
    ? await import('./bgcs/route')
    : entity === 'gcfs'
      ? await import('./gcfs/route')
      : await import('./samples/route');
  const res = await mod.GET(new Request(`http://localhost/api/${entity}?${qs}`));
  expect(res.status, `GET /api/${entity}?${qs} did not answer 200`).toBe(200);
  const paged = captured.filter((c) => /LIMIT\s+\$\d+\s+OFFSET\s+\$\d+\s*$/i.test(c.text));
  expect(paged.length, `no paged query issued for /api/${entity}?${qs}`).toBeGreaterThan(0);
  return finalOrderBy(paged[paged.length - 1]!.text);
}

beforeEach(() => {
  captured.length = 0;
  // isBrowseSearchEnabled reads process.env per call, so no module reset is needed.
  vi.stubEnv('OPENSEARCH_BROWSE_ENABLED', 'false');
  vi.stubEnv('OPENSEARCH_BROWSE_BGCS_ENABLED', 'false');
  vi.stubEnv('OPENSEARCH_BROWSE_GCFS_ENABLED', 'false');
  vi.stubEnv('OPENSEARCH_BROWSE_SAMPLES_ENABLED', 'false');
});

describe('/api/gcfs ORDER BY', () => {
  it.each([
    'name', 'memberCount', 'assemblyCount', 'productDiversity', 'taxaCount',
    'avgDistance', 'petName', 'biomeDistribution', 'bgcLength', 'not-a-sort-field',
  ])('ends on g.gcf_id ASC for sortField=%s', async (sortField) => {
    expect(await orderByFor('gcfs', `sortField=${sortField}&limit=50`)).toMatch(/, g\.gcf_id ASC$/);
  });

  it('honours sortOrder without touching the tiebreaker direction', async () => {
    // ASC always, to match the OpenSearch side.
    expect(await orderByFor('gcfs', 'sortField=name&sortOrder=desc&limit=50'))
      .toBe('g.gcf_name DESC, g.gcf_id ASC');
  });

  it.each(['cluster_method', 'clusterMethod'])(
    'sortField=%s is NOT a sort — it falls through to the default, tiebreaker included',
    async (sortField) => {
      // cluster_method holds one value, so sorting on it needs the tiebreaker on
      // every row (12ms -> 476ms); it is simply not offered as a sort.
      const order = await orderByFor('gcfs', `sortField=${sortField}&limit=50`);
      expect(order).toBe('g.gcf_name ASC, g.gcf_id ASC');
      expect(order).not.toContain('cluster_method');
    },
  );
});

describe('/api/samples ORDER BY', () => {
  it.each([
    'bgcs', 'assemblies', 'gcfs', 'id', 'environment', 'material', 'feature',
    'not-a-sort-field',
  ])('ends on sb.id ASC for sortField=%s', async (sortField) => {
    expect(await orderByFor('samples', `sortField=${sortField}&limit=50`)).toMatch(/, sb\.id ASC$/);
  });

  it('tiebreaks the id sort too — its key is a COALESCE, not the primary key', async () => {
    expect(await orderByFor('samples', 'sortField=id&limit=50'))
      .toBe("COALESCE(sb.external_id, sb.id::text) DESC, sb.id ASC");
  });
});

describe('/api/bgcs ORDER BY', () => {
  it.each(['length', 'genes', 'gcf', 'distance', 'assembly', 'type', 'class', 'name', 'biome'])(
    'ends on b.id ASC for sortField=%s',
    async (sortField) => {
      expect(await orderByFor('bgcs', `sortField=${sortField}&limit=50`)).toMatch(/, b\.id ASC$/);
    },
  );

  it('does NOT tiebreak sortField=completeness (measured: index scan -> full sort, 13ms -> >20s)', async () => {
    // TIEBREAK_EXEMPT_BGC_SORTS in the route carries the numbers. DESC is the
    // default direction; the point is the absence of `, b.id ASC`.
    expect(await orderByFor('bgcs', 'sortField=completeness&limit=50')).toBe('b.is_complete DESC');
  });

  it('DOES tiebreak completeness as the second key of the default sort', async () => {
    // idx_bgcs_length_complete carries the id behind `length`, so the plan does not change.
    expect(await orderByFor('bgcs', 'sortFields=length,completeness&sortOrders=desc,desc&limit=50'))
      .toMatch(/, b\.id ASC$/);
  });

  it('refuses sortField=taxonomy unnarrowed and tiebreaks the default it falls back to', async () => {
    // applySortFieldGuard drops an unnarrowed `taxonomy`.
    expect(await orderByFor('bgcs', 'sortField=taxonomy&limit=50'))
      .toBe('(b.end_pos - b.start_pos) DESC, b.is_complete DESC, b.id ASC');
  });

  it.each(['id', 'not-a-sort-field'])(
    'does not double the key for sortField=%s — that branch already orders by b.id',
    async (sortField) => {
      const order = await orderByFor('bgcs', `sortField=${sortField}&limit=50`);
      expect(order).toBe('b.id DESC');
      expect(order.match(/b\.id/g)).toHaveLength(1);
    },
  );

  it('tiebreaks the multi-field sort', async () => {
    expect(await orderByFor('bgcs', 'sortFields=length,completeness&sortOrders=desc,desc&limit=50'))
      .toBe('(b.end_pos - b.start_pos) DESC, b.is_complete DESC, b.id ASC');
  });

  it("tiebreaks the table's default sort, which sends no sort parameter", async () => {
    expect(await orderByFor('bgcs', 'limit=50'))
      .toBe('(b.end_pos - b.start_pos) DESC, b.is_complete DESC, b.id ASC');
  });

  it('does not double the key when the multi-field sort already ends on it', async () => {
    const order = await orderByFor('bgcs', 'sortFields=length,id&sortOrders=desc,asc&limit=50');
    expect(order).toBe('(b.end_pos - b.start_pos) DESC, b.id ASC');
  });
});

/**
 * An unspecified sort direction must mean the same on both backends; SQL
 * defaults to DESC to match the index. Three spots default independently.
 */
describe('/api/bgcs default sort DIRECTION matches the index', () => {
  it('defaults a single-field sort to DESC, not ASC', async () => {
    expect(await orderByFor('bgcs', 'sortField=length&limit=50'))
      .toMatch(/^\(b\.end_pos - b\.start_pos\) DESC/);
  });

  it('still honours an explicit asc', async () => {
    expect(await orderByFor('bgcs', 'sortField=length&sortOrder=asc&limit=50'))
      .toMatch(/^\(b\.end_pos - b\.start_pos\) ASC/);
  });

  it('defaults an UNRECOGNISED multi-field order to DESC', async () => {
    // The index treats anything but "asc" as desc.
    expect(await orderByFor('bgcs', 'sortFields=length&sortOrders=sideways&limit=50'))
      .toMatch(/^\(b\.end_pos - b\.start_pos\) DESC/);
  });

  it('pads a MISSING positional order with DESC', async () => {
    // The index has no padding step; a missing order falls through to its default.
    const order = await orderByFor('bgcs', 'sortFields=length,completeness&sortOrders=asc&limit=50');
    expect(order).toMatch(/^\(b\.end_pos - b\.start_pos\) ASC/);
    expect(order).toMatch(/b\.is_complete DESC/);
  });
});
