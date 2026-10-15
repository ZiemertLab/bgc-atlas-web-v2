import { NextRequest, NextResponse } from 'next/server';
import { facetValues } from '@/lib/opensearch/client';

export const dynamic = 'force-dynamic';

// GET /api/search/properties/facet-values?field=pfam&prefix=PF001&size=20
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const field = searchParams.get('field');
  const prefix = searchParams.get('prefix') ?? '';
  const size = Number(searchParams.get('size') ?? 20);

  if (!field) {
    return NextResponse.json({ error: 'field is required' }, { status: 400 });
  }

  try {
    const values = await facetValues(field, prefix, Number.isFinite(size) ? size : 20);
    return NextResponse.json({ field, values });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // unknown/non-facet field is a client error; anything else is a backend error
    const status = message.startsWith('not a facet field') ? 400 : 502;
    if (status === 502) console.error('[api/search/properties/facet-values] error:', err);
    return NextResponse.json({ error: message }, { status });
  }
}
