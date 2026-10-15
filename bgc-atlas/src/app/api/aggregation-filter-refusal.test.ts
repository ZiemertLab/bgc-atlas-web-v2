import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * A refused advanced filter on the four aggregation panels must be a 400 with
 * the repair text, while a backend outage stays a 502 (the panels hide on 5xx).
 *
 * Two ways a refusal gets past the gate:
 *  - gcfs force-supports `?study=` (the SQL fallback has no study filter).
 *  - `supportsAdvancedBrowse` never checks a condition's value, so
 *    `length equals "abc"` passes the gate and fails in the builder.
 *
 * Refusals come from the routes' real imports so filterRefusalResponse's
 * `instanceof` checks see the same classes.
 */

const { aggregate } = vi.hoisted(() => ({ aggregate: vi.fn() }));

vi.mock('@/lib/opensearch/browse-client', () => ({
  isBrowseSearchEnabled: () => true,
  searchBrowseIndex: async () => { throw new Error('not used by these routes'); },
  aggregateBrowseIndex: aggregate,
}));

const { serializeFilterGroup } = await import('@/lib/filters/types');

type Handler = (req: NextRequest) => Promise<Response>;

// A negative on a multi-valued gcfs field is served (plain must_not); what the
// index refuses is an operator the field disallows. familyClass is equals/not_equals only.
const GCF_UNSERVABLE = { id: 'c', field: 'familyClass', operator: 'contains', value: 'seed' } as const;

const ROUTES = {
  'bgcs/taxonomy-composition': {
    path: '/api/bgcs/taxonomy-composition',
    load: () => import('@/app/api/bgcs/taxonomy-composition/route') as Promise<{ GET: Handler }>,
    unusable: { id: 'c', field: 'genes', operator: 'gte', value: 'many' },
    servable: { id: 'c', field: 'length', operator: 'gt', value: 5000 },
    clause: '{"range":{"length":{"gt":5000}}}',
    /** `b.product` is negated one unnested element at a time. */
    unservable: { id: 'c', field: 'productType', operator: 'not_equals', value: 'T1PKS' },
    base: '',
  },
  'bgcs/distribution': {
    path: '/api/bgcs/distribution',
    load: () => import('@/app/api/bgcs/distribution/route') as Promise<{ GET: Handler }>,
    // The SQL resolver refuses this too, rather than reading it as `is_complete = false`.
    unusable: { id: 'c', field: 'completeness', operator: 'equals', value: 'unknown' },
    servable: { id: 'c', field: 'genes', operator: 'gte', value: 12 },
    clause: '{"range":{"num_cds_features":{"gte":12}}}',
    unservable: { id: 'c', field: 'productCategory', operator: 'not_contains', value: 'PKS' },
    base: '',
  },
  'gcfs/distribution': {
    path: '/api/gcfs/distribution',
    load: () => import('@/app/api/gcfs/distribution/route') as Promise<{ GET: Handler }>,
    unusable: { id: 'c', field: 'memberBgcCount', operator: 'gt', value: 'lots' },
    servable: { id: 'c', field: 'memberBgcCount', operator: 'gte', value: 10 },
    clause: '{"range":{"member_bgc_count":{"gte":10}}}',
    unservable: GCF_UNSERVABLE,
    // Without ?study= the gate refuses the unservable payload with `{ supported: false }` at 200.
    base: 'study=42&',
  },
  'gcfs/taxonomy-composition': {
    path: '/api/gcfs/taxonomy-composition',
    load: () => import('@/app/api/gcfs/taxonomy-composition/route') as Promise<{ GET: Handler }>,
    unusable: { id: 'c', field: 'memberBgcCount', operator: 'gt', value: 'lots' },
    servable: { id: 'c', field: 'memberBgcCount', operator: 'gt', value: 10 },
    clause: '{"range":{"member_bgc_count":{"gt":10}}}',
    unservable: GCF_UNSERVABLE,
    // See gcfs/distribution.
    base: 'study=42&',
  },
} as const;

type RouteKey = keyof typeof ROUTES;
const ALL = Object.keys(ROUTES) as RouteKey[];

const encode = (conditions: unknown[]) =>
  serializeFilterGroup({ id: 'g', operator: 'AND', conditions, groups: [] } as never);

const call = async (route: RouteKey, query: string) => {
  const { GET } = await ROUTES[route].load();
  const res = await GET(new NextRequest(`http://localhost${ROUTES[route].path}?${query}`));
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* not JSON */ }
  return { status: res.status, json };
};

const withFilter = (route: RouteKey, conditions: unknown[]) =>
  `${ROUTES[route].base}advancedFilters=${encodeURIComponent(encode(conditions))}`;

beforeEach(() => {
  aggregate.mockReset().mockResolvedValue({ aggregations: {} });
});

describe.each(ALL)('%s: a refused filter is a 400, not a 502', (route) => {
  it('400s with the repair text when a condition cannot be honoured', async () => {
    const { status, json } = await call(route, withFilter(route, [ROUTES[route].unusable]));
    expect(status).toBe(400);
    // 5xx bodies are never rendered by these panels.
    expect(String(json.message)).toContain(ROUTES[route].unusable.field);
    expect(json.error).toBe(json.message);
    expect(json.rejected).toEqual([
      expect.objectContaining({ field: ROUTES[route].unusable.field, reason: 'unusable_value' }),
    ]);
    expect(aggregate).not.toHaveBeenCalled();
  });

  it('still 502s when the aggregation backend itself fails', async () => {
    aggregate.mockRejectedValueOnce(new Error('opensearch exploded'));
    const { status, json } = await call(route, withFilter(route, [ROUTES[route].servable]));
    expect(status).toBe(502);
    expect(json.error).toMatch(/^Something went wrong on our side\. Please try again in a few minutes\. \(ref [0-9a-f]{6}\)$/);
    expect(JSON.stringify(json)).not.toContain('exploded');
  });

  it('renders the panel for a servable advanced filter, filtered by it', async () => {
    const { status, json } = await call(route, withFilter(route, [ROUTES[route].servable]));
    expect(status).toBe(200);
    expect(json.supported).toBe(true);
    // Assert on the emitted body: the gate could admit the request while the
    // clause is missing from the aggregation.
    expect(aggregate).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(aggregate.mock.calls[0][1])).toContain(ROUTES[route].clause);
  });
});

describe('gcfs/taxonomy-composition: ?study= carries a refusal past the gate', () => {
  it('400s when the payload could not be read at all', async () => {
    const { status, json } = await call('gcfs/taxonomy-composition', 'study=42&advancedFilters=%7Bnot-base64');
    expect(status).toBe(400);
    expect(String(json.message)).toMatch(/truncated|not a filter group/i);
    expect(String(json.message)).not.toMatch(/aggregation backend/i);
    expect(json.error).toBe(json.message);
    expect(aggregate).not.toHaveBeenCalled();
  });

  it('400s and names the field when the index cannot answer the condition', async () => {
    // ?study= is force-supported, so the gate lets an unservable group through.
    const { status, json } = await call(
      'gcfs/taxonomy-composition',
      withFilter('gcfs/taxonomy-composition', [GCF_UNSERVABLE]),
    );
    expect(status).toBe(400);
    expect(json.rejected).toEqual([
      expect.objectContaining({ field: 'familyClass', reason: 'unsupported_operator' }),
    ]);
    expect(String(json.message)).toContain('familyClass');
    expect(aggregate).not.toHaveBeenCalled();
  });
});

describe('the gate still hides the panel where it always did', () => {
  // With no force-true, bad payloads never reach the builder: the panel hides at
  // 200 (panels key on `supported`). Unservable bgcs payloads are array fields SQL
  // negates elementwise; the gcfs ones are refused operators (GCF_UNSERVABLE).
  it.each(ALL)('%s hides for a condition the index cannot answer', async (route) => {
    const { status, json } = await call(
      route,
      `advancedFilters=${encodeURIComponent(encode([ROUTES[route].unservable]))}`,
    );
    expect(status).toBe(200);
    expect(json).toMatchObject({ supported: false, reason: 'unsupported-filters' });
    expect(aggregate).not.toHaveBeenCalled();
  });

  it.each(ALL)('%s STAYS live for a negative on a single-target field', async (route) => {
    const { field } = ROUTES[route].servable;
    const { status, json } = await call(
      route,
      `advancedFilters=${encodeURIComponent(encode([
        { id: 'c', field, operator: 'not_equals', value: 1 },
      ]))}`,
    );
    expect(status).toBe(200);
    expect(json.supported).toBe(true);
    expect(aggregate).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(aggregate.mock.calls[0][1])).toContain('"exists"');
  });

  it.each(['bgcs/taxonomy-composition', 'bgcs/distribution'] as const)(
    '%s hides rather than 400s for an unreadable payload',
    async (route) => {
      // advancedFiltersServable refuses on exactly the predicate the parser throws
      // on, so MalformedFilterPayloadError cannot reach the catch.
      const { status, json } = await call(route, 'advancedFilters=%7Bnot-base64');
      expect(status).toBe(200);
      expect(json).toMatchObject({ supported: false, reason: 'unsupported-filters' });
      expect(aggregate).not.toHaveBeenCalled();
    },
  );
});
