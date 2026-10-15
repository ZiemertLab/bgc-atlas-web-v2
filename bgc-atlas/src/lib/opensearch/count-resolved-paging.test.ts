import { describe, expect, it, vi } from 'vitest';
import { buildBrowseSearchRequest } from './browse-query';
import type { CountResolvedPage } from './deep-paging';

vi.mock('@/lib/prisma', () => ({ default: { $queryRaw: async () => [] } }));

const { planCountResolvedPage, countResolvedPageBody, isPastTheEnd, BROWSE_RESULT_WINDOW } = await import('./deep-paging');

/**
 * Runs the resolver against a model index rather than canned counts: off-by-one
 * arithmetic yields well-formed pages of the wrong documents, which mocks would not catch.
 */

interface Doc {
  id: string; length: number; genes: number; complete: boolean; cat: string;
  // Multi-valued, like product_category: sorts by max (desc) or min (asc).
  cats: string[];
  // Too many values to enumerate, like taxonomy_sort: walked, not listed.
  taxon: string;
  // Nullable, like gcf_id: missing documents sort last in both directions.
  gcf: string | null;
}

/** A UUID-shaped id spread across the key space, which the resolver bisects. An odd
 *  multiplier modulo 2^48 is a bijection, so they stay unique. */
const uuidLike = (seed: number, salt: number): string => {
  const mixed = (seed * 0x9e3779b1 + salt * 0x7f4a7c15) % 2 ** 48;
  const hex = Math.abs(Math.floor(mixed)).toString(16).padStart(12, '0');
  const tail = String(seed).padStart(8, '0');
  const body = (hex + tail + '0'.repeat(32)).slice(0, 32);
  return `${body.slice(0, 8)}-${body.slice(8, 12)}-${body.slice(12, 16)}-${body.slice(16, 20)}-${body.slice(20)}`;
};

const corpus: Doc[] = [];
let n = 0;
const push = (length: number, genes: number, complete: boolean, cat: string) => {
  // Every 3rd document is unclustered, so the missing run exceeds the result window.
  const gcf = n % 3 === 0 ? null : uuidLike(n % 900, 7);
  // Half the documents carry two categories, so `term` and "sorts under" differ
  // for them -- which is exactly what a naive implementation gets wrong.
  const cats = n % 2 === 0 ? [cat] : [cat, 'terpene'];
  // ~1,800 distinct taxa over 55,000 documents: well past any enumeration
  // ceiling the test could set, and unevenly sized like the real thing.
  const taxon = `t__${String(n % 1800).padStart(5, '0')}`;
  corpus.push({ id: uuidLike(n, 1), length, genes, complete, cat, gcf, cats, taxon });
  n += 1;
};
// A long tail of distinct lengths, deep enough that the offsets below stay past
// the result window even after a filter halves the corpus.
for (let len = 50_000; len > 20_000; len -= 1) {
  push(len, len % 400, len % 3 === 0, len % 2 === 0 ? 'NRPS' : 'PKS');
}
// One block far larger than the window, where the walk is needed.
for (let i = 0; i < 25_000; i += 1) push(1_000, i % 400, i < 14_000, i % 2 === 0 ? 'NRPS' : 'PKS');

type Query = Record<string, unknown>;
type SortSpec = Array<Record<string, { order?: string }>>;

const asQuery = (value: unknown) => value as Query;
const asQueries = (value: unknown) => (value ?? []) as Query[];

/** Direction of the leading key, for fields whose sort value depends on it. */
let sortDir: 'asc' | 'desc' = 'desc';

/** Each sortable field, as the index names it. */
const valueOf = (doc: Doc, field: string): number | string => {
  if (field === 'length') return doc.length;
  if (field === 'num_cds_features') return doc.genes;
  if (field === 'is_complete') return doc.complete ? 1 : 0;
  if (field === 'bgc_id') return doc.id;
  if (field === 'gcf_id') return doc.gcf ?? '';
  if (field === 'taxonomy_sort') return doc.taxon;
  // Multi-valued sort value: max for desc, min for asc.
  if (field === 'product_category') return sortDir === 'asc'
    ? [...doc.cats].sort()[0]
    : [...doc.cats].sort().slice(-1)[0];
  throw new Error(`model has no field ${field}`);
};

const has = (doc: Doc, field: string) => (field === 'gcf_id' ? doc.gcf !== null : true);

const comparator = (sort: SortSpec) => (a: Doc, b: Doc): number => {
  sortDir = sort[0][Object.keys(sort[0])[0]]?.order === 'asc' ? 'asc' : 'desc';
  // Missing sorts last either way (OpenSearch's default).
  const leading = Object.keys(sort[0])[0];
  const aHas = has(a, leading);
  const bHas = has(b, leading);
  if (aHas !== bHas) return aHas ? -1 : 1;
  for (const entry of sort) {
    const field = Object.keys(entry)[0];
    const dir = entry[field]?.order === 'asc' ? 1 : -1;
    const av = valueOf(a, field);
    const bv = valueOf(b, field);
    if (av === bv) continue;
    return (typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv))) * dir;
  }
  return 0;
};

/** Evaluate the query shapes the resolver builds. Anything else is a bug. */
const matches = (doc: Doc, query: Query): boolean => {
  if (query.match_all) return true;

  if (query.bool) {
    const bool = asQuery(query.bool);
    const should = asQueries(bool.should);
    return asQueries(bool.filter).every((f) => matches(doc, f))
      && !asQueries(bool.must_not).some((f) => matches(doc, f))
      && (should.length === 0 || should.some((f) => matches(doc, f)));
  }

  if (query.exists) {
    return has(doc, (asQuery(query.exists).field as string));
  }

  if (query.range) {
    const range = asQuery(query.range);
    const field = Object.keys(range)[0];
    if (!has(doc, field)) return false;
    // A range on a multi-valued field matches when ANY element does.
    if (field === 'product_category') {
      const b = asQuery(range[field]) as { gt?: string; lt?: string };
      if (b.gt !== undefined) return doc.cats.some((c) => c > b.gt!);
      if (b.lt !== undefined) return doc.cats.some((c) => c < b.lt!);
      return true;
    }
    if (field === 'taxonomy_sort') {
      const b = asQuery(range[field]) as { gt?: string; lt?: string; lte?: string; gte?: string };
      if (b.gt !== undefined && !(doc.taxon > b.gt)) return false;
      if (b.lt !== undefined && !(doc.taxon < b.lt)) return false;
      if (b.lte !== undefined && !(doc.taxon <= b.lte)) return false;
      if (b.gte !== undefined && !(doc.taxon >= b.gte)) return false;
      return true;
    }
    const bounds = asQuery(range[field]) as
      { gt?: number | string; lt?: number | string; lte?: number | string; gte?: number | string };
    const value = valueOf(doc, field);
    if (bounds.gt !== undefined && !(value > bounds.gt)) return false;
    if (bounds.lt !== undefined && !(value < bounds.lt)) return false;
    if (bounds.lte !== undefined && !(value <= bounds.lte)) return false;
    if (bounds.gte !== undefined && !(value >= bounds.gte)) return false;
    return true;
  }

  if (query.term) {
    const term = asQuery(query.term);
    if ('product_category' in term) return doc.cats.includes(term.product_category as string);
    if ('taxonomy_sort' in term) return doc.taxon === term.taxonomy_sort;
    if ('gcf_id' in term) return doc.gcf === term.gcf_id;
    if ('length' in term) return doc.length === term.length;
    if ('num_cds_features' in term) return doc.genes === term.num_cds_features;
    if ('is_complete' in term) return doc.complete === term.is_complete;
    // The bgcs index spells it `product_category`; the gcfs one uses the plural.
    if ('product_category' in term) return doc.cat === term.product_category;
    if ('product_categories' in term) return doc.cat === term.product_categories;
  }

  if (query.terms) {
    const terms = asQuery(query.terms);
    const field = Object.keys(terms)[0];
    if (field?.startsWith('product')) return (terms[field] as string[]).includes(doc.cat);
  }

  const textual = query.wildcard ?? query.match ?? query.match_phrase;
  if (textual) {
    const clause = asQuery(textual);
    const raw = clause[Object.keys(clause)[0]];
    const value = typeof raw === 'object' && raw !== null
      ? ((raw as { value?: unknown; query?: unknown }).value ?? (raw as { query?: unknown }).query)
      : raw;
    return doc.cat.toLowerCase().includes(String(value).replace(/\*/g, '').toLowerCase());
  }

  throw new Error(`model cannot evaluate: ${JSON.stringify(query)}`);
};

const hits = (query: Query, sort: SortSpec) =>
  corpus.filter((d) => matches(d, query)).sort(comparator(sort));

const count = async (query: Query) => corpus.filter((d) => matches(d, query)).length;

const tupleOf = (doc: Doc, sort: SortSpec) =>
  sort.map((entry) => valueOf(doc, Object.keys(entry)[0]));

/**
 * `search_after` compares the key against each document's sort values; the resolver's
 * synthetic tuples need not match a document.
 */
const afterTuple = (doc: Doc, after: unknown[], sort: SortSpec): boolean => {
  // Missing documents sort last via a sentinel, so no key built from a real value
  // seeks into them.
  const leadingField = Object.keys(sort[0])[0];
  if (!has(doc, leadingField)) return true;

  for (let i = 0; i < sort.length; i += 1) {
    const entry = sort[i];
    const field = Object.keys(entry)[0];
    const dir = entry[field]?.order === 'asc' ? 1 : -1;
    const value = valueOf(doc, field);
    const key = after[i] as number | string;
    if (value === key) continue;
    const cmp = typeof value === 'number' && typeof key === 'number'
      ? value - key
      : String(value).localeCompare(String(key));
    return cmp * dir > 0;
  }
  return false;   // equal on every key is not AFTER
};

const startAfter = (docs: Doc[], after: unknown[] | undefined, sort: SortSpec) => {
  if (!after) return -1;
  const i = docs.findIndex((d) => afterTuple(d, after, sort));
  return i < 0 ? docs.length : i;
};

/** The model's `seek`: sort keys only, resuming after a tuple. */
const seek = async (body: Query) => {
  const sort = body.sort as SortSpec;
  const docs = hits(asQuery(body.query), sort);
  const after = body.search_after as unknown[] | undefined;
  const start = after ? startAfter(docs, after, sort) : 0;
  return docs.slice(start, start + (body.size as number)).map((d) => tupleOf(d, sort));
};

/** The page the model says an offset holds, under the caller's own sort. */
const truePage = (query: Query, sort: SortSpec, offset: number, limit = 50) =>
  hits(query, sort).slice(offset, offset + limit).map((d) => d.id);

/** The page the resolver's plan produces, evaluated against the model. */
const resolvedPage = (plan: {
  query: Query; sort: unknown; from: number; size: number; sliceFrom: number; after?: unknown[];
}) => {
  const sort = plan.sort as SortSpec;
  const docs = hits(plan.query, sort);
  const start = plan.after ? startAfter(docs, plan.after, sort) : plan.from;
  return docs.slice(start, start + plan.size).slice(plan.sliceFrom).map((d) => d.id);
};

/** The model's `aggregate`: a terms list, or a composite walk in key order. */
const aggregate = async (body: Query) => {
  const aggs = asQuery(body.aggs);

  if (aggs.walk) {
    const composite = asQuery(asQuery(aggs.walk).composite);
    const source = asQuery((composite.sources as Query[])[0]);
    const terms = asQuery(asQuery(source.k).terms);
    const field = terms.field as string;
    const desc = terms.order === 'desc';
    const size = composite.size as number;
    const after = composite.after as { k?: string } | undefined;

    const docs = corpus.filter((d) => matches(d, asQuery(body.query)));
    const counts = new Map<string, number>();
    for (const d of docs) {
      const v = String(valueOf(d, field));
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    let keys = [...counts.keys()].sort();
    if (desc) keys.reverse();
    if (after?.k) keys = keys.filter((k) => (desc ? k < after.k! : k > after.k!));
    const page = keys.slice(0, size);
    return {
      aggregations: {
        walk: {
          buckets: page.map((k) => ({ key: { k }, doc_count: counts.get(k)! })),
          ...(page.length === size ? { after_key: { k: page[page.length - 1] } } : {}),
        },
      },
    };
  }
  const field = asQuery(asQuery(aggs.values).terms).field as string;
  const docs = corpus.filter((d) => matches(d, asQuery(body.query)));
  const seen = new Map<string, number>();
  for (const d of docs) {
    const values = field === 'product_category' ? d.cats : [String(valueOf(d, field))];
    for (const v of values) seen.set(v, (seen.get(v) ?? 0) + 1);
  }
  return {
    aggregations: {
      values: {
        buckets: [...seen].map(([key, doc_count]) => ({ key, doc_count })),
        sum_other_doc_count: 0,
      },
    },
  };
};

const params = (query: string) => new URLSearchParams(query);
/** The browse request these cases describe, built the way the route builds it. */
const request = (query: string) =>
  buildBrowseSearchRequest('bgcs', params(query)) as unknown as Parameters<typeof planCountResolvedPage>[0];
const planRaw = (query: string) => planCountResolvedPage(request(query), count, seek, aggregate);
/** A resolvable page, or null. Past-the-end is its own case, tested on its own. */
const plan = async (query: string): Promise<CountResolvedPage | null> => {
  const resolved = await planRaw(query);
  if (isPastTheEnd(resolved)) throw new Error(`unexpected past-the-end for ${query}`);
  return resolved;
};

const DEFAULT_SORT: SortSpec = [
  { length: { order: 'desc' } }, { is_complete: { order: 'desc' } }, { bgc_id: { order: 'asc' } },
];
const NRPS: Query = { bool: { filter: [{ term: { product_category: 'NRPS' } }] } };

// Dozens of counts per resolution over the in-memory corpus can exceed vitest's 5s default.
describe('planCountResolvedPage', { timeout: 20_000 }, () => {
  it('declines a page the result window can already serve', async () => {
    expect(await plan('limit=50&offset=9950&category=NRPS')).toBeNull();
  });

  it('declines a sort whose leading key it cannot bisect', async () => {
    // `name` is a keyword; this resolver cannot bisect it.
    expect(await plan('limit=50&offset=20000&sortField=name')).toBeNull();
  });

  it('resolves a filtered deep page to exactly the right documents', async () => {
    for (const offset of [10_000, 12_345, 20_000]) {
      const resolved = await plan(`limit=50&offset=${offset}&category=NRPS`);
      expect(resolved, `offset ${offset}`).not.toBeNull();
      expect(resolvedPage(resolved!), `offset ${offset}`)
        .toEqual(truePage(NRPS, DEFAULT_SORT, offset));
    }
  });

  it('resolves an UNFILTERED page under a non-default sort', async () => {
    const sort: SortSpec = [{ num_cds_features: { order: 'desc' } }, { bgc_id: { order: 'asc' } }];
    for (const offset of [10_000, 30_000]) {
      const resolved = await plan(`limit=50&offset=${offset}&sortField=genes&sortOrder=desc`);
      expect(resolved, `offset ${offset}`).not.toBeNull();
      expect(resolvedPage(resolved!), `offset ${offset}`)
        .toEqual(truePage({ match_all: {} }, sort, offset));
    }
  });

  it('resolves an ASCENDING sort, where the comparison flips', async () => {
    // asc: documents sorting before a value are below it.
    const sort: SortSpec = [{ num_cds_features: { order: 'asc' } }, { bgc_id: { order: 'asc' } }];
    const resolved = await plan('limit=50&offset=20000&sortField=genes&sortOrder=asc');
    expect(resolved).not.toBeNull();
    expect(resolvedPage(resolved!)).toEqual(truePage({ match_all: {} }, sort, 20_000));
  });

  it('resolves a filtered page under a non-default sort', async () => {
    const sort: SortSpec = [{ num_cds_features: { order: 'desc' } }, { bgc_id: { order: 'asc' } }];
    const resolved = await plan('limit=50&offset=12000&sortField=genes&sortOrder=desc&category=NRPS');
    expect(resolved).not.toBeNull();
    expect(resolvedPage(resolved!)).toEqual(truePage(NRPS, sort, 12_000));
  });

  it('reports the total of the unnarrowed query, not the narrowed one', async () => {
    const resolved = await plan('limit=50&offset=12000&category=NRPS');
    expect(resolved!.total).toBe(await count(NRPS));
    expect(await count(resolved!.query)).toBeLessThan(resolved!.total);
  });

  it('reaches into a tie block far larger than the window', async () => {
    const total = corpus.length;
    expect(total).toBe(55_000);
    for (const offset of [35_000, 50_000, total - 51]) {
      const resolved = await plan(`limit=50&offset=${offset}`);
      expect(resolved, `offset ${offset}`).not.toBeNull();
      // Either form stays inside the window: `from + size`, or an over-fetch.
      expect(resolved!.from + resolved!.size).toBeLessThanOrEqual(BROWSE_RESULT_WINDOW);
      expect(resolvedPage(resolved!), `offset ${offset}`)
        .toEqual(truePage({ match_all: {} }, DEFAULT_SORT, offset));
    }
  });

  it('bisects the tiebreaker rather than walking the block', async () => {
    // The probe count is the assertion: the walk would reach the right page too, slower.
    const resolved = await plan('limit=50&offset=54949');
    expect(resolved).not.toBeNull();
    expect(resolved!.after, 'seeks rather than paging with from').toBeDefined();
    expect(resolved!.probes).toBeLessThan(25);
    expect(resolvedPage(resolved!)).toEqual(truePage({ match_all: {} }, DEFAULT_SORT, 54_949));
  });

  it('resolves a UUID-leading sort', async () => {
    const sort: SortSpec = [{ bgc_id: { order: 'desc' } }, { bgc_id: { order: 'asc' } }];
    const resolved = await plan('limit=50&offset=20000&sortField=id&sortOrder=desc');
    expect(resolved).not.toBeNull();
    expect(resolvedPage(resolved!)).toEqual(truePage({ match_all: {} }, sort.slice(0, 1), 20_000));
  });

  it('resolves a sort on a field that is missing from some documents', async () => {
    const sort: SortSpec = [{ gcf_id: { order: 'asc' } }, { bgc_id: { order: 'asc' } }];
    const clustered = corpus.filter((d) => d.gcf !== null).length;
    for (const offset of [12_000, clustered + 100, corpus.length - 51]) {
      const resolved = await plan(`limit=50&offset=${offset}&sortField=gcf&sortOrder=asc`);
      expect(resolved, `offset ${offset}`).not.toBeNull();
      expect(resolvedPage(resolved!), `offset ${offset}`)
        .toEqual(truePage({ match_all: {} }, sort, offset));
    }
  });

  it('resolves a boolean-leading sort', async () => {
    const sort: SortSpec = [{ is_complete: { order: 'desc' } }, { bgc_id: { order: 'asc' } }];
    for (const offset of [12_000, 20_000, 40_000]) {
      const resolved = await plan(`limit=50&offset=${offset}&sortField=completeness&sortOrder=desc`);
      expect(resolved, `offset ${offset}`).not.toBeNull();
      expect(resolvedPage(resolved!), `offset ${offset}`)
        .toEqual(truePage({ match_all: {} }, sort, offset));
    }
  });

  it('resolves an ARRAY-valued sort, where term and sort value differ', async () => {
    // `term: {field: v}` matches documents sorting under a different value; the block
    // is "has v, and nothing greater".
    const sort: SortSpec = [{ product_category: { order: 'desc' } }, { bgc_id: { order: 'asc' } }];
    for (const offset of [10_000, 25_000, 40_000]) {
      const resolved = await plan(`limit=50&offset=${offset}&sortField=category&sortOrder=desc`);
      expect(resolved, `offset ${offset}`).not.toBeNull();
      expect(resolvedPage(resolved!), `offset ${offset}`)
        .toEqual(truePage({ match_all: {} }, sort, offset));
    }
  });

  it('resolves an ascending array sort, which orders by the MIN element', async () => {
    const sort: SortSpec = [{ product_category: { order: 'asc' } }, { bgc_id: { order: 'asc' } }];
    const resolved = await plan('limit=50&offset=20000&sortField=category&sortOrder=asc');
    expect(resolved).not.toBeNull();
    expect(resolvedPage(resolved!)).toEqual(truePage({ match_all: {} }, sort, 20_000));
  });

  it('declines an enumerable sort when the value list comes back truncated', async () => {
    const truncated = async (body: Query) => {
      const full = await aggregate(body) as { aggregations: { values: Record<string, unknown> } };
      return { aggregations: { values: { ...full.aggregations.values, sum_other_doc_count: 5 } } };
    };
    const resolved = await planCountResolvedPage(
      request('limit=50&offset=20000&sortField=category'), count, seek, truncated,
    );
    expect(resolved).toBeNull();
  });

  it('declines an enumerable sort when no aggregation is available', async () => {
    expect(await planCountResolvedPage(
      request('limit=50&offset=20000&sortField=category'), count, seek,
    )).toBeNull();
  });

  it('walks a keyword with too many values to enumerate', async () => {
    const sort: SortSpec = [{ taxonomy_sort: { order: 'asc' } }, { bgc_id: { order: 'asc' } }];
    for (const offset of [12_000, 30_000, 54_949]) {
      const resolved = await plan(`limit=50&offset=${offset}&sortField=taxonomy&sortOrder=asc`);
      expect(resolved, `offset ${offset}`).not.toBeNull();
      expect(resolvedPage(resolved!), `offset ${offset}`)
        .toEqual(truePage({ match_all: {} }, sort, offset));
    }
  });

  it('walks from whichever end is nearer', async () => {
    // The arithmetic differs between the two walking directions.
    const near = await plan('limit=50&offset=12000&sortField=taxonomy&sortOrder=asc');
    const far = await plan(`limit=50&offset=${corpus.length - 51}&sortField=taxonomy&sortOrder=asc`);
    expect(near).not.toBeNull();
    expect(far).not.toBeNull();
    // The far page is deeper, yet costs no more probes -- that is the point.
    expect(far!.probes).toBeLessThanOrEqual(near!.probes + 1);
  });

  it('reports an offset past the end as such, with the real total', async () => {
    const everything = await count({ match_all: {} });
    expect(await planRaw('limit=50&offset=999999999')).toEqual({
      pastEnd: true, total: everything, probes: 1,
    });
    const nrps = await count(NRPS);
    expect(await planRaw('limit=50&offset=900000&category=NRPS'))
      .toEqual({ pastEnd: true, total: nrps, probes: 1 });
  });

  it('still resolves the last real page, one short of the end', async () => {
    const nrps = await count(NRPS);
    const resolved = await plan(`limit=50&offset=${nrps - 1}&category=NRPS`);
    expect(resolved).not.toBeNull();
    expect(resolved!.total).toBe(nrps);
  });

  it('spends few probes', async () => {
    // Each probe is a round trip; bisection stops once the remainder fits.
    const resolved = await plan('limit=50&offset=20000&category=NRPS');
    expect(resolved!.probes).toBeLessThan(30);
  });
});

describe('countResolvedPageBody', () => {
  it('pages with from, which is legal without search_after', async () => {
    const resolved = await plan('limit=50&offset=12000&category=NRPS');
    const body = countResolvedPageBody(resolved!);
    expect(body.from).toBe(resolved!.from);
    expect(body).not.toHaveProperty('search_after');
    expect((body.from as number) + (body.size as number)).toBeLessThanOrEqual(BROWSE_RESULT_WINDOW);
  });

  it('seeks instead of paging when the block had to be walked', async () => {
    const resolved = await plan('limit=50&offset=54949');
    const body = countResolvedPageBody(resolved!);
    // `from` is refused alongside search_after, so it must be absent entirely.
    expect(body).not.toHaveProperty('from');
    expect(body.search_after).toEqual(resolved!.after);
    expect(body.size).toBeLessThanOrEqual(BROWSE_RESULT_WINDOW);
  });

  it('reads in the caller\'s ordering, not a fixed one', async () => {
    const resolved = await plan('limit=50&offset=20000&sortField=genes&sortOrder=asc');
    expect(countResolvedPageBody(resolved!).sort)
      .toEqual([{ num_cds_features: { order: 'asc' } }, { bgc_id: { order: 'asc' } }]);
  });
});
