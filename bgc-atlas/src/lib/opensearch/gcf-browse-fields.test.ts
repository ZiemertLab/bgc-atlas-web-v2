import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ECO_ANY_RETRY_MS,
  ECO_ANY_TTL_MS,
  ecoAnyIndexed,
  ecoAnyIndexedFresh,
  mappingHasEcoAny,
  setEcoAnyIndexedForTests,
} from './gcf-browse-fields';
import { facetValues } from './client';

// The shape of GET <alias>/_mapping/field/<fields>: one entry per index behind
// the alias, each listing only the requested fields it actually maps.
const index = (fields: string[]) => ({
  mappings: Object.fromEntries(fields.map((f) => [f, { full_name: f, mapping: { [f]: { type: 'keyword' } } }])),
});
const ALL = ['eco_l1_any', 'eco_l2_any', 'eco_l3_any', 'eco_l4_any', 'eco_l5_any'];
const WITH = { gcf_browse_v20261023any: index(ALL) };
const WITHOUT = { gcf_browse_v20261022share: { mappings: {} } };

describe('mappingHasEcoAny', () => {
  it('is true when the index maps all five lists', () => {
    expect(mappingHasEcoAny(WITH)).toBe(true);
  });

  it('is false for the index before the patch, which maps none', () => {
    expect(mappingHasEcoAny(WITHOUT)).toBe(false);
  });

  it('is false when any level is missing', () => {
    expect(mappingHasEcoAny({ x: index(ALL.slice(0, 4)) })).toBe(false);
  });

  it('is false when one of two indexes behind the alias lacks them', () => {
    expect(mappingHasEcoAny({ a: index(ALL), b: { mappings: {} } })).toBe(false);
  });

  it('is false for an error body or nothing', () => {
    expect(mappingHasEcoAny({})).toBe(false);
    expect(mappingHasEcoAny(null)).toBe(false);
  });
});

// ------------------------------------------------------------- the cache

type Reply = { status: number; body: unknown } | Error;
let replies: Reply[] = [];
let searches: Array<{ url: string; body: Record<string, unknown> }> = [];
const fetchMock = vi.fn(async (url: string, init?: { body?: string }) => {
  if (String(url).includes('/_mapping/field/')) {
    const next = replies.shift() ?? { status: 200, body: WITHOUT };
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body), { status: next.status });
  }
  // osFetch: the picker's terms aggregation.
  searches.push({ url: String(url), body: JSON.parse(init?.body ?? '{}') });
  return new Response(JSON.stringify({ aggregations: { v: { buckets: [{ key: 'Marine', doc_count: 3 }] } } }));
});
const mappingCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('/_mapping/field/')).length;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
  replies = [];
  searches = [];
  setEcoAnyIndexedForTests(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setEcoAnyIndexedForTests(null);
});

describe('the eco_l<n>_any presence cache', () => {
  it('answers false until the first check lands, then the checked value', async () => {
    replies = [{ status: 200, body: WITH }];
    expect(ecoAnyIndexed()).toBe(false);        // kicks the check, answers what it knows
    await vi.waitFor(() => expect(ecoAnyIndexed()).toBe(true));
    expect(mappingCalls()).toBe(1);
  });

  it('keeps the value for one TTL, then looks again', async () => {
    replies = [{ status: 200, body: WITH }, { status: 200, body: WITHOUT }];
    expect(await ecoAnyIndexedFresh()).toBe(true);
    vi.advanceTimersByTime(ECO_ANY_TTL_MS - 1);
    expect(ecoAnyIndexed()).toBe(true);
    expect(mappingCalls()).toBe(1);
    // An alias rolled back to an index without the lists: seen within a minute.
    vi.advanceTimersByTime(1);
    expect(await ecoAnyIndexedFresh()).toBe(false);
    expect(mappingCalls()).toBe(2);
  });

  it('a failed check keeps the last value and retries after ECO_ANY_RETRY_MS, not a full TTL', async () => {
    replies = [{ status: 200, body: WITH }, { status: 503, body: {} }, new Error('ECONNRESET'),
      { status: 200, body: WITH }];
    expect(await ecoAnyIndexedFresh()).toBe(true);

    vi.advanceTimersByTime(ECO_ANY_TTL_MS);
    expect(await ecoAnyIndexedFresh()).toBe(true);      // 503: not an answer
    expect(mappingCalls()).toBe(2);
    vi.advanceTimersByTime(ECO_ANY_RETRY_MS - 1);
    expect(await ecoAnyIndexedFresh()).toBe(true);      // not yet due
    expect(mappingCalls()).toBe(2);
    vi.advanceTimersByTime(1);
    expect(await ecoAnyIndexedFresh()).toBe(true);      // network error: still not an answer
    expect(mappingCalls()).toBe(3);
    vi.advanceTimersByTime(ECO_ANY_RETRY_MS);
    expect(await ecoAnyIndexedFresh()).toBe(true);      // recovered
    expect(mappingCalls()).toBe(4);
  });

  it('only a 200 that lacks the fields writes false', async () => {
    replies = [{ status: 200, body: WITH }, { status: 404, body: { error: 'index_not_found' } }];
    expect(await ecoAnyIndexedFresh()).toBe(true);
    vi.advanceTimersByTime(ECO_ANY_TTL_MS);
    expect(await ecoAnyIndexedFresh()).toBe(true);
  });

  it('concurrent callers share one request', async () => {
    replies = [{ status: 200, body: WITH }];
    const answers = await Promise.all([
      ecoAnyIndexedFresh(), ecoAnyIndexedFresh(), ecoAnyIndexedFresh(),
      Promise.resolve(ecoAnyIndexed()),
    ]);
    expect(answers.slice(0, 3)).toEqual([true, true, true]);
    expect(mappingCalls()).toBe(1);
  });
});

describe('the ecosystem value picker follows the index', () => {
  const aggregatedField = () =>
    ((searches.at(-1)?.body.aggs as Record<string, { terms: { field: string } }>).v.terms.field);

  it('reads eco_l<n>_any once the index has it', async () => {
    replies = [{ status: 200, body: WITH }];
    await facetValues('gcf_ecosystem_l3', 'mar', 10);
    expect(aggregatedField()).toBe('eco_l3_any');
  });

  it('reads eco_l<n>_ge10 before the patch, and switches after the swap', async () => {
    replies = [{ status: 200, body: WITHOUT }, { status: 200, body: WITH }];
    await facetValues('gcf_ecosystem_l2', '', 10);
    expect(aggregatedField()).toBe('eco_l2_ge10');
    vi.advanceTimersByTime(ECO_ANY_TTL_MS);
    await facetValues('gcf_ecosystem_l2', '', 10);
    expect(aggregatedField()).toBe('eco_l2_any');
  });

  it('the product picker does not depend on it', async () => {
    await facetValues('gcf_product_type', 'lanthi', 10);
    expect(aggregatedField()).toBe('product_terms');
  });
});
