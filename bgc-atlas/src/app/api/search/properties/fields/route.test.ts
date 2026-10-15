import { describe, expect, it } from 'vitest';
import { GET } from './route';
import { API_ENDPOINTS } from '@/lib/api-catalog';
import { bgcPropertyFilterFields } from '@/lib/filters/bgc-property-fields';
import { makeResolver } from '@/lib/opensearch/query';
import type { FilterOperator, FilterValue } from '@/lib/filters/types';

const ALL_OPERATORS: FilterOperator[] = [
  'equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with',
  'gt', 'gte', 'lt', 'lte', 'between', 'in', 'not_in',
];

/**
 * The field-discovery endpoint (also read by the MCP server). The builder's
 * `allowedOperators` is narrower than what the API honours (e.g. `product
 * contains`), so both sets ship.
 */
interface FieldEntry {
  id: string;
  label: string;
  type: string;
  plottable: boolean;
  operators: { acceptedByApi: FilterOperator[]; offeredByBuilder: FilterOperator[] };
  options?: { label: string; value: string }[];
}

const read = async (): Promise<FieldEntry[]> =>
  ((await GET().json()) as { fields: FieldEntry[] }).fields;

describe('/api/search/properties/fields', () => {
  it('serves both operator sets for every field, under names that say whose they are', async () => {
    const fields = await read();
    expect(fields).toHaveLength(bgcPropertyFilterFields.length);
    const bad: string[] = [];
    for (const f of fields) {
      if (Array.isArray(f.operators)) { bad.push(`${f.id}: operators is still a bare list`); continue; }
      const keys = Object.keys(f.operators ?? {}).sort();
      if (keys.join(',') !== 'acceptedByApi,offeredByBuilder') bad.push(`${f.id}: operators keys = [${keys}]`);
      if (!f.operators?.acceptedByApi?.length) bad.push(`${f.id}: no acceptedByApi`);
      if (!f.operators?.offeredByBuilder?.length) bad.push(`${f.id}: no offeredByBuilder`);
    }
    expect(bad).toEqual([]);
  });

  it('declares an API set that is a superset of the builder set, over the whole catalog', async () => {
    const fields = await read();
    const missing: string[] = [];
    for (const f of fields) {
      const api = new Set(f.operators.acceptedByApi);
      for (const op of f.operators.offeredByBuilder) {
        if (!api.has(op)) missing.push(`${f.id}: builder offers ${op}, API set omits it`);
      }
    }
    expect(missing).toEqual([]);
  });

  /**
   * Pinned against the resolver, not honourableOperators (comparing to the
   * route's own helper would be a tautology).
   */
  it('publishes exactly the operators the resolver builds a clause for', async () => {
    const resolve = makeResolver(bgcPropertyFilterFields);
    const drift: string[] = [];
    for (const f of await read()) {
      const numeric = bgcPropertyFilterFields.find((d) => d.id === f.id)!.os === 'number';
      const published = new Set(f.operators.acceptedByApi);
      for (const op of ALL_OPERATORS) {
        // A value the kind can use, so a null clause means "operator not supported".
        const value: FilterValue = op === 'between'
          ? (numeric ? [1, 2] : ['x', 'y'])
          : op === 'in' || op === 'not_in'
            ? (numeric ? [1] : ['x'])
            : (numeric ? 1 : 'x');
        const honoured = resolve({ id: 'c', field: f.id, operator: op, value }) !== null;
        if (honoured !== published.has(op)) {
          drift.push(`${f.id} ${op}: resolver ${honoured ? 'honours' : 'refuses'} it, payload says otherwise`);
        }
      }
    }
    expect(drift).toEqual([]);
  });

  it('publishes the builder set exactly as the registry declares it', async () => {
    const byId = new Map(bgcPropertyFilterFields.map((d) => [d.id, d]));
    const drift: string[] = [];
    for (const f of await read()) {
      const declared = byId.get(f.id)!.allowedOperators ?? [];
      if (f.operators.offeredByBuilder.join(',') !== declared.join(',')) {
        drift.push(`${f.id}: [${f.operators.offeredByBuilder}] != allowedOperators [${declared}]`);
      }
    }
    expect(drift).toEqual([]);
  });

  it('product: the API honours `contains`, the builder does not offer it', async () => {
    const f = (await read()).find((x) => x.id === 'product')!;
    expect(f.operators.acceptedByApi).toContain('contains');
    expect(f.operators.offeredByBuilder).not.toContain('contains');
  });

  it('still carries the rest of the field vocabulary', async () => {
    const fields = await read();
    const f = fields.find((x) => x.id === 'product')!;
    expect(f).toMatchObject({ id: 'product', label: 'Product', type: 'select', plottable: true });
    expect(fields.filter((x) => x.options).length).toBe(
      bgcPropertyFilterFields.filter((d) => d.options).length,
    );
  });

  it('is described in the API catalog by the names it actually serves', async () => {
    const fields = await read();
    const entry = API_ENDPOINTS.find((e) => e.path === '/api/search/properties/fields');
    expect(entry).toBeDefined();
    for (const key of Object.keys(fields[0].operators)) {
      expect(entry!.returns).toContain(key);
    }
  });
});
