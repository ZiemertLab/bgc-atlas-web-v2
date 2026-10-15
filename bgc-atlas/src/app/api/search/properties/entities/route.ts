import { NextRequest, NextResponse } from 'next/server';
import { searchEntities } from '@/lib/opensearch/client';
import { FamilyScopeError, searchFamilyScope } from '@/lib/opensearch/family-scope';
import { UnhonourableQueryError } from '@/lib/filters/unhonourable-query';
import type { FilterGroup } from '@/lib/filters/types';
import { serverError } from '@/lib/api/errors';

export const dynamic = 'force-dynamic';

// POST /api/search/properties/entities
// Body: { group, entity: 'gcfs' | 'samples', page?, size?,
//         familyScope?: { cohorts: FilterGroup[], minPurity?: number } }
//
// Groups the matching BGC set by GCF or sample. The BGC path stays on
// /api/search/properties because the response shapes differ.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const entity = body.entity === 'samples' ? 'samples' : body.entity === 'gcfs' ? 'gcfs' : null;
    if (!entity) {
      return NextResponse.json({ error: "entity must be 'gcfs' or 'samples'" }, { status: 400 });
    }
    // Family scope asks about the family's footprint, so it runs its own two-pass
    // aggregation; GCFs only.
    const scope = body.familyScope;
    if (scope && Array.isArray(scope.cohorts) && scope.cohorts.length > 0) {
      if (entity !== 'gcfs') {
        return NextResponse.json({ error: 'familyScope applies to GCFs only' }, { status: 400 });
      }
      const result = await searchFamilyScope({
        group: (body.group ?? null) as FilterGroup | null,
        cohorts: scope.cohorts as FilterGroup[],
        minPurity: typeof scope.minPurity === 'number' ? scope.minPurity : undefined,
        page: Number(body.page) || 1,
        size: Number(body.size) || 25,
      });
      return NextResponse.json(result);
    }

    const result = await searchEntities({
      group: (body.group ?? null) as FilterGroup | null,
      entity,
      page: Number(body.page) || 1,
      size: Number(body.size) || 25,
    });
    return NextResponse.json(result);
  } catch (err) {
    // Covers every family-scope cohort too, so none can silently widen the purity measurement.
    if (err instanceof UnhonourableQueryError) {
      return NextResponse.json(
        { error: err.message, rejected: err.conditions },
        { status: 400 },
      );
    }
    // A too-broad cohort set is the caller's query: 400 so the UI shows guidance.
    if (err instanceof FamilyScopeError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return serverError(err, '[api/search/properties/entities]', { status: 502 });
  }
}
