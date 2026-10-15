import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `abstract_state` on the study endpoints: 'available' | 'withheld' | 'absent'.
 * Without it "never had an abstract" and "withheld by licence" look identical,
 * and an MCP client might write a withheld abstract from memory. Fixtures are
 * real rows covering both branches.
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

type Stmt = { sql?: string; strings?: string[]; values?: unknown[] };
const sqlText = (q: unknown) => {
  const stmt = q as Stmt;
  return stmt.sql ?? (stmt.strings ?? []).join('?');
};
const issuedSql = () => queryRaw.mock.calls.map(([q]) => sqlText(q));

// Fixtures: rows as they stand in bgc_atlas_v2.
/** Bell_2018_groundwater: text withheld (OUP reuse rights permit reading, not redistribution). */
const WITHHELD = {
  id: 'ca709f6a-706e-527c-b6b2-60dedb6fbdec',
  study_key: 'Bell_2018_groundwater',
  abstract: null as string | null,
  abstract_source: 'crossref',
  abstract_doi: '10.1038/s41396-020-0602-x',
  abstract_license: 'https://academic.oup.com/pages/standard-publication-reuse-rights',
  abstract_publisher: 'Oxford University Press (OUP)',
  abstract_withheld: true,
};

/** Angle_2017_wetland — Nature Communications, CC BY 4.0, ours to serve. */
const OPEN = {
  id: '82e1e840-40dd-5be7-96e9-f3d1ff6899d0',
  study_key: 'Angle_2017_wetland',
  abstract: 'The current paradigm, widely incorporated in soil biogeochemical models...',
  abstract_source: 'crossref',
  abstract_doi: '10.1038/s41467-017-01753-4',
  abstract_license: 'https://creativecommons.org/licenses/by/4.0',
  abstract_publisher: 'Springer Science and Business Media LLC',
  abstract_withheld: false,
};

/** A study nobody ever published a paper for: the genuine third state. */
const NONE = {
  id: '00000000-0000-5000-8000-000000000000',
  study_key: 'PRJNA000000',
  abstract: null as string | null,
  abstract_source: null,
  abstract_doi: null,
  abstract_license: null,
  abstract_publisher: null,
  abstract_withheld: false,
};

type Fixture = {
  id: string;
  study_key: string;
  abstract: string | null;
  abstract_source: string | null;
  abstract_doi: string | null;
  abstract_license: string | null;
  abstract_publisher: string | null;
  abstract_withheld: boolean;
};

const siblingRow = (f: Fixture) => ({
  id: f.id,
  accession: 'PRJNA1',
  bioproject: 'PRJNA1',
  abstract: f.abstract,
  abstract_source: f.abstract_source,
  abstract_doi: f.abstract_doi,
  abstract_license: f.abstract_license,
  abstract_publisher: f.abstract_publisher,
  abstract_withheld: f.abstract_withheld,
  doi: f.abstract_doi,
  pmid: null,
});

const summaryRow = (f: Fixture) => ({
  study_key: f.study_key,
  study_id: f.id,
  title: 'A study',
  study_name: f.study_key,
  center_name: 'JGI',
  accession: 'PRJNA1',
  bioproject: 'PRJNA1',
  study_type: null,
  sample_count: 3,
  total_bgcs: 10,
  clustered_bgcs: 7,
  gcf_coverage: 0.7,
  distinct_gcfs: 5,
  exclusive_gcfs: 2,
  rare_gcfs: 1,
  pct_complete: 10,
  product_type_count: 4,
  product_category_dist: { RiPP: 3 },
  top_exclusive_gcfs: null,
  primary_biome: 'soil',
  gold_bucket: 'Environmental',
});

const mockDetail = (f: Fixture) => {
  queryRaw.mockReset().mockImplementation(async (q: unknown) => {
    const text = sqlText(q);
    if (text.includes('study_bgc_summary sbs')) return [summaryRow(f)];
    if (text.includes('FROM studies') && text.includes('abstract_withheld')) return [siblingRow(f)];
    if (text.includes('geo_tagged')) return [{ total: 3, unit_count: 3, geo_tagged: 0, south: null, north: null, west: null, east: null }];
    return [];
  });
};

/**
 * Returns the abstract columns only when the statement aggregates them, like
 * a database would, so deleting the join cannot pass.
 */
const ABSTRACT_JOIN = 'bool_or(abstract_withheld)';

const mockList = (fixtures: Fixture[]) => {
  queryRaw.mockReset().mockImplementation(async (q: unknown) => {
    const text = sqlText(q);
    if (text.includes('COUNT(*)')) return [{ total: fixtures.length }];
    const joined = text.includes(ABSTRACT_JOIN);
    return fixtures.map((f) => ({
      ...summaryRow(f),
      eco_l1: null,
      eco_l2: null,
      eco_l3: null,
      // The state is derived from these by the same helper the detail route uses.
      ...(joined ? { has_abstract: f.abstract !== null, abstract_withheld: f.abstract_withheld } : {}),
    }));
  });
};

type Row = Record<string, unknown>;

const getDetail = async (id: string, query = '') => {
  const { GET } = await import('./[id]/route');
  const res = await GET(
    new Request(`http://localhost/api/studies/${id}${query}`),
    { params: Promise.resolve({ id }) },
  );
  const json = (await res.json()) as { success: boolean; data: { study: Row } };
  return { status: res.status, study: json.data.study };
};

const getList = async (query = '') => {
  const { GET } = await import('./route');
  const res = await GET(new Request(`http://localhost/api/studies${query}`));
  const json = (await res.json()) as { success: boolean; data: { data: Row[] } };
  return { status: res.status, rows: json.data.data };
};

beforeEach(() => {
  store.clear();
  queryRaw.mockReset().mockResolvedValue([]);
});

describe('GET /api/studies/{id}', () => {
  it('states that a withheld abstract was withheld', async () => {
    mockDetail(WITHHELD);
    const { study } = await getDetail(WITHHELD.id);
    expect(study.abstract_state).toBe('withheld');
    // null is also what an unpublished study returns.
    expect(study.abstract).toBeNull();
  });

  it('gives a withheld abstract a resolvable link to where it may be read', async () => {
    mockDetail(WITHHELD);
    const { study } = await getDetail(WITHHELD.id);
    expect(study.abstract_doi).toBe('10.1038/s41396-020-0602-x');
    expect(study.abstract_url).toBe('https://doi.org/10.1038/s41396-020-0602-x');
    expect(study.abstract_license).toBe(WITHHELD.abstract_license);
    expect(study.abstract_publisher).toBe('Oxford University Press (OUP)');
  });

  it('states that a redistributable abstract is available, with its attribution', async () => {
    mockDetail(OPEN);
    const { study } = await getDetail(OPEN.id);
    expect(study.abstract_state).toBe('available');
    expect(study.abstract).toBe(OPEN.abstract);
    // CC BY requires attribution, so publisher and licence must be in the record.
    expect(study.abstract_source).toBe('crossref');
    expect(study.abstract_license).toBe('https://creativecommons.org/licenses/by/4.0');
    expect(study.abstract_publisher).toBe('Springer Science and Business Media LLC');
    expect(study.abstract_url).toBe('https://doi.org/10.1038/s41467-017-01753-4');
  });

  it('distinguishes a study that never had an abstract from a withheld one', async () => {
    mockDetail(NONE);
    const { study } = await getDetail(NONE.id);
    expect(study.abstract_state).toBe('absent');
    expect(study.abstract_url).toBeNull();
  });

  it('carries the state on ?brief=1, which is what the /studies row expander reads', async () => {
    mockDetail(WITHHELD);
    const { study } = await getDetail(WITHHELD.id, '?brief=1');
    expect(study.abstract_state).toBe('withheld');
    expect(study.abstract_url).toBe('https://doi.org/10.1038/s41396-020-0602-x');
  });

  // Older-shape cache entries lack the field, so the key must change.
  it('reads under a cache key that pre-change entries cannot occupy', async () => {
    mockDetail(WITHHELD);
    await getDetail(WITHHELD.id);
    await getDetail(WITHHELD.id, '?brief=1');
    const keys = [...store.keys()];
    expect(keys).not.toContain(`studies:detail:${WITHHELD.id}`);
    expect(keys).not.toContain(`studies:brief:${WITHHELD.id}`);
    expect(keys.some((k) => k.startsWith('studies:detail:'))).toBe(true);
    expect(keys.some((k) => k.startsWith('studies:brief:'))).toBe(true);
  });
});

describe('GET /api/studies', () => {
  it('states the abstract state on every row', async () => {
    mockList([WITHHELD, OPEN, NONE]);
    const { rows } = await getList('?limit=3');
    expect(rows.map((r) => r.abstract_state)).toEqual(['withheld', 'available', 'absent']);
  });

  it('asks the database for the state rather than defaulting it', async () => {
    mockList([WITHHELD]);
    await getList('?limit=1');
    // Without the join every row would silently read 'absent'.
    const page = issuedSql().find((t) => t.includes('study_ecosystem_dist')) ?? '';
    expect(page).toContain('bool_or(abstract IS NOT NULL)');
    expect(page).toContain(ABSTRACT_JOIN);
  });

  it('leaves the detail endpoint to carry the licence and the link', async () => {
    // The list carries only the state; licence, publisher and DOI stay on the detail endpoint.
    mockList([WITHHELD]);
    const { rows } = await getList('?limit=1');
    expect(rows[0]).not.toHaveProperty('abstract_license');
    expect(rows[0]).not.toHaveProperty('abstract_url');
  });

  it('reads under a cache key that pre-change entries cannot occupy', async () => {
    mockList([WITHHELD]);
    await getList('?limit=1');
    expect([...store.keys()].every((k) => !k.startsWith('studies:list:v6:'))).toBe(true);
  });
});
