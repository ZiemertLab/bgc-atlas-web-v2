import { NextRequest, NextResponse } from 'next/server';
import type { FilterGroup } from '@/lib/filters/types';
import { MAX_DISTRIBUTION_FIELDS, plottableFields } from '@/lib/filters/bgc-property-fields';
import { aggregateFields } from '@/lib/opensearch/client';
import { hydrateGcfNames } from '@/lib/opensearch/hydrate';
import { UnhonourableQueryError } from '@/lib/filters/unhonourable-query';
import { serverError } from '@/lib/api/errors';

export const dynamic = 'force-dynamic';

interface AggregateRequest {
  group?: FilterGroup | null;
  fields?: string[];
  size?: number;
}

const allowed = new Set(plottableFields);
// Shared with the Distributions panel so the caps cannot drift apart.
const MAX_FIELDS = MAX_DISTRIBUTION_FIELDS;
const MAX_TERMS_SIZE = 100; // top-N bars per categorical distribution

// POST /api/search/properties/aggregate
// Body: { group: FilterGroup|null, fields: string[], size?: number }
// Returns: { results: DistResult[] } over the entire matched set, not one page.
export async function POST(req: NextRequest) {
  let body: AggregateRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const requested = Array.isArray(body.fields) ? body.fields : [];
  // Off-allowlist fields are a 400, not a silent omission (which would read as "no data").
  const unplottable = requested.filter((f) => typeof f !== 'string' || !allowed.has(f)).map(String);
  if (unplottable.length) {
    return NextResponse.json({
      error: `Cannot plot a distribution of ${unplottable.map((f) => `"${f}"`).join(', ')}.`
        + ' Only keyword, boolean and numeric fields have a distribution.',
      rejectedFields: unplottable,
    }, { status: 400 });
  }
  // Truncate rather than refuse, but name what was dropped in `omittedFields`:
  // a bare absence was read by the panel as "still loading".
  const fields = requested.slice(0, MAX_FIELDS);
  const omittedFields = requested.slice(MAX_FIELDS);
  if (!fields.length) {
    return NextResponse.json({ results: [] });
  }
  const size = Math.min(MAX_TERMS_SIZE, Math.max(1, Number(body.size) || 20));

  try {
    const results = await aggregateFields(body.group ?? null, fields, size);
    // Label gcf_id buckets with GCF names instead of raw UUIDs.
    const gcf = results.find((r) => r.field === 'gcf_id');
    if (gcf?.buckets.length) {
      try {
        const names = await hydrateGcfNames(gcf.buckets.map((b) => b.key));
        gcf.buckets = gcf.buckets.map((b) => ({ ...b, label: names[b.key] ?? b.key }));
      } catch (e) {
        // best-effort; fall back to UUIDs
        console.error('[api/search/properties/aggregate] gcf name hydrate failed:', e);
      }
    }
    return NextResponse.json(omittedFields.length ? { results, omittedFields } : { results });
  } catch (err) {
    if (err instanceof UnhonourableQueryError) {
      return NextResponse.json(
        { error: err.message, rejected: err.conditions },
        { status: 400 },
      );
    }
    return serverError(err, '[api/search/properties/aggregate]', { status: 502 });
  }
}
