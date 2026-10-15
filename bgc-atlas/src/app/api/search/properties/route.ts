import { NextRequest, NextResponse } from 'next/server';
import type { FilterGroup } from '@/lib/filters/types';
import { defaultFacetFields } from '@/lib/filters/bgc-property-fields';
import { searchProperties } from '@/lib/opensearch/client';
import { UnhonourableQueryError } from '@/lib/filters/unhonourable-query';
import { hydrateDisplayFields } from '@/lib/opensearch/hydrate';
import { serverError } from '@/lib/api/errors';

export const dynamic = 'force-dynamic';

interface PropertySearchRequest {
  group?: FilterGroup | null;
  page?: number;
  size?: number;
  facetFields?: string[];
  sort?: { field: string; order: 'asc' | 'desc' };
}

// POST /api/search/properties
// Body: { group: FilterGroup|null, page?, size?, facetFields?[] }
// Returns: { total, hits: <display projection>[], facets: {field: [{value,count}]} }
// 400 when a condition cannot be honoured (unknown field, unsupported operator,
// non-aggregatable facet field), since skipping it widens the answer. Empty-value
// conditions (half-built in the UI) are still dropped silently.
export async function POST(req: NextRequest) {
  let body: PropertySearchRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  try {
    const result = await searchProperties({
      group: body.group ?? null,
      page: body.page,
      size: body.size,
      facetFields: body.facetFields ?? defaultFacetFields,
      sort: body.sort,
    });

    if (result.hits.length) {
      const ids = result.hits.map((h) => String(h.bgc_id ?? '')).filter(Boolean);
      try {
        const hydrated = await hydrateDisplayFields(ids);
        result.hits = result.hits.map((h) => ({ ...h, ...(hydrated[String(h.bgc_id)] ?? {}) }));
      } catch (e) {
        // best-effort; never fail the search because of it
        console.error('[api/search/properties] hydrate failed:', e);
      }
    }

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof UnhonourableQueryError) {
      // `error` is rendered verbatim and must name the field and operator: the
      // holder of a saved or shared filter can only repair it from this text.
      return NextResponse.json(
        { error: err.message, rejected: err.conditions, rejectedFacetFields: err.facetFields },
        { status: 400 },
      );
    }
    return serverError(err, '[api/search/properties]', { status: 502 });
  }
}
