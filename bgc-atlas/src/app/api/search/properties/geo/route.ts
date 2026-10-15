import { NextRequest, NextResponse } from 'next/server';
import type { FilterGroup } from '@/lib/filters/types';
import { geoCount, geoGrid, type GeoBbox } from '@/lib/opensearch/client';
import { UnhonourableQueryError } from '@/lib/filters/unhonourable-query';
import { serverError } from '@/lib/api/errors';

export const dynamic = 'force-dynamic';

interface GeoRequest {
  group?: FilterGroup | null;
  colorField?: string | null;
  zoom?: number;
  bbox?: GeoBbox | null;
  /** Skip the grid and just report how many matching BGCs are mappable. */
  countOnly?: boolean;
}

// POST /api/search/properties/geo
// Body: { group: FilterGroup|null, colorField?: string, zoom?: number, bbox?: {...} }
// Returns the whole matched set aggregated onto a lat/lon grid (no hits fetched).
export async function POST(req: NextRequest) {
  let body: GeoRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  try {
    if (body.countOnly) {
      return NextResponse.json({ hits: await geoCount(body.group ?? null) });
    }
    // geoGrid clamps zoom and normalises the bbox, so a bad viewport degrades to a
    // coarser grid rather than an error or unbounded aggregation.
    const result = await geoGrid({
      group: body.group ?? null,
      colorField: typeof body.colorField === 'string' ? body.colorField : null,
      zoom: Number(body.zoom) || 0,
      bbox: body.bbox ?? null,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof UnhonourableQueryError) {
      return NextResponse.json(
        { error: err.message, rejected: err.conditions },
        { status: 400 },
      );
    }
    return serverError(err, '[api/search/properties/geo]', { status: 502 });
  }
}
