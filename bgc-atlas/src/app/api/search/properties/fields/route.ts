import { NextResponse } from 'next/server';
import { bgcPropertyFilterFields, plottableFields } from '@/lib/filters/bgc-property-fields';
import { honourableOperators } from '@/lib/opensearch/query';

// The query builder's field registry, for API clients. Static: changes only on deploy.
//   offeredByBuilder -- the field's `allowedOperators` (the UI dropdown).
//   acceptedByApi    -- what lib/opensearch/query.ts builds a clause for; wider,
//     e.g. `product contains "t1pks"`. Clients should read this one.
// `type` alone is not enough: `is_complete` is 'select' but boolean, so no `in`.
export const dynamic = 'force-static';

export function GET() {
  const plottable = new Set(plottableFields);
  return NextResponse.json({
    fields: bgcPropertyFilterFields.map((f) => ({
      id: f.id,
      label: f.label,
      type: f.type,
      plottable: plottable.has(f.id),
      operators: {
        acceptedByApi: honourableOperators(f),
        offeredByBuilder: f.allowedOperators ?? [],
      },
      ...(f.options ? { options: f.options } : {}),
    })),
  });
}
