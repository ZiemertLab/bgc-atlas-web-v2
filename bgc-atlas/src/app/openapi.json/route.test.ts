import { describe, expect, it } from 'vitest';
import { GET } from './route';
import { API_ENDPOINTS } from '@/lib/api-catalog';
import { bgcPropertyFilterFields } from '@/lib/filters/bgc-property-fields';
import { ABSTRACT_STATES } from '@/lib/abstract-license';

const render = async (): Promise<Record<string, unknown>> =>
  (await GET().json()) as Record<string, unknown>;

const collectRefs = (doc: unknown): { at: string; ref: string }[] => {
  const found: { at: string; ref: string }[] = [];
  const walk = (node: unknown, at: string) => {
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${at}/${i}`));
      return;
    }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (k === '$ref' && typeof v === 'string') found.push({ at, ref: v });
        else walk(v, `${at}/${k.replace(/~/g, '~0').replace(/\//g, '~1')}`);
      }
    }
  };
  walk(doc, '');
  return found;
};

const resolve = (doc: unknown, ref: string): unknown => {
  if (!ref.startsWith('#/')) return undefined;
  let cur: unknown = doc;
  for (const raw of ref.slice(2).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
    if (cur === undefined) return undefined;
  }
  return cur;
};

describe('/openapi.json', () => {
  // A `$defs` self-reference nested in a request body resolves against the root and dangles.
  it('every $ref resolves against the document root', async () => {
    const doc = await render();
    const refs = collectRefs(doc);
    expect(refs.length).toBeGreaterThan(0);
    const dangling = refs.filter(({ ref }) => resolve(doc, ref) === undefined);
    expect(dangling).toEqual([]);
  });

  it('describes the property-search request body', async () => {
    const doc = await render();
    const paths = doc.paths as Record<string, Record<string, never>>;
    const op = paths['/api/search/properties'].post as unknown as {
      parameters: unknown[];
      requestBody: { content: { 'application/json': { schema: Record<string, never> } } };
    };
    // Body fields are catalog params for the prose only; they must not become query parameters.
    expect(op.parameters).toEqual([]);
    const schema = op.requestBody.content['application/json'].schema;
    expect(Object.keys(schema.properties as object).sort()).toEqual(
      ['facetFields', 'group', 'page', 'size', 'sort'],
    );
  });

  it('spells the condition operators exactly as the field registry allows', async () => {
    const doc = await render();
    const condition = resolve(doc, '#/components/schemas/PropertySearchFilterCondition') as {
      properties: { operator: { enum: string[] } };
    };
    const declared = new Set(bgcPropertyFilterFields.flatMap((f) => f.allowedOperators ?? []));
    expect([...condition.properties.operator.enum].sort()).toEqual([...declared].sort());
  });

  // Routes read arrays with `getAll`; a comma-joined value would be read as one value.
  it('serializes every array parameter as a repeated key', async () => {
    const doc = await render();
    const paths = doc.paths as Record<string, Record<string, { parameters?: unknown[] }>>;
    const arrays = Object.entries(paths).flatMap(([path, methods]) =>
      Object.entries(methods).flatMap(([method, op]) =>
        ((op.parameters ?? []) as {
          name: string;
          schema: { type: string; items?: { type?: string } };
          style?: string;
          explode?: boolean;
        }[])
          .filter((p) => p.schema.type === 'array')
          .map((p) => ({
            at: `${method.toUpperCase()} ${path}?${p.name}`,
            style: p.style,
            explode: p.explode,
            items: p.schema.items?.type,
          })),
      ),
    );
    expect(arrays.length).toBeGreaterThan(0);
    for (const p of arrays) {
      expect(p).toEqual({ at: p.at, style: 'form', explode: true, items: expect.any(String) });
    }
  });

  it.each(['/api/studies', '/api/studies/{id}'])(
    '%s documents abstract_state and every value it can take',
    async (path) => {
      const endpoint = API_ENDPOINTS.find((e) => e.path === path);
      expect(endpoint).toBeDefined();
      expect(endpoint!.returns).toContain('abstract_state');
      for (const state of ABSTRACT_STATES) {
        expect(endpoint!.returns).toContain(`\`${state}\``);
      }
      const doc = await render();
      const paths = doc.paths as Record<string, Record<string, { responses: Record<string, { description: string }> }>>;
      expect(paths[path].get.responses['200'].description).toBe(endpoint!.returns);
    },
  );

  it('quotes the true field count', async () => {
    const fields = API_ENDPOINTS.find((e) => e.path === '/api/search/properties/fields');
    expect(fields).toBeDefined();
    expect(fields!.returns).toContain(`${bgcPropertyFilterFields.length} fields`);
  });
});
