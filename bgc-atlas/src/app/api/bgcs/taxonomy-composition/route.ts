import { NextRequest, NextResponse } from 'next/server';
import { aggregateBrowseIndex, isBrowseSearchEnabled } from '@/lib/opensearch/browse-client';
import { buildBrowseFilters, supportsBrowseSearch } from '@/lib/opensearch/browse-query';
import {
  buildCompositionRequest, isTaxonomyRank, parseCompositionResponse,
} from '@/lib/opensearch/taxonomy-composition';
import { filterRefusalResponse } from '@/lib/api/filter-refusal';
import { serverError } from '@/lib/api/errors';

export const dynamic = 'force-dynamic';

// GET /api/bgcs/taxonomy-composition?rank=phylum&<any /bgcs table filter>
// Returns: CompositionResult, or { supported: false, reason } when this filter
// set cannot be answered from the browse index.
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;

  const rank = params.get('rank') ?? 'phylum';
  if (!isTaxonomyRank(rank)) {
    return NextResponse.json({ error: `unknown taxonomic rank: ${rank}` }, { status: 400 });
  }

  // Both gates hide the panel rather than summarise a different set than the
  // table's SQL fallback would list.
  if (!isBrowseSearchEnabled('bgcs')) {
    return NextResponse.json({ supported: false, reason: 'browse-index-disabled' });
  }
  if (!supportsBrowseSearch('bgcs', params)) {
    return NextResponse.json({ supported: false, reason: 'unsupported-filters' });
  }

  try {
    const filters = buildBrowseFilters('bgcs', params);
    const response = await aggregateBrowseIndex('bgcs', buildCompositionRequest(rank, filters));
    return NextResponse.json({ supported: true, ...parseCompositionResponse(rank, response) });
  } catch (err) {
    // An unreadable payload is refused by the gate; an unhonourable value is not
    // (supportsAdvancedBrowse never checks values), so it lands here as a 400.
    const refusal = filterRefusalResponse(err);
    if (refusal) return refusal;
    return serverError(err, '[api/bgcs/taxonomy-composition]', { status: 502 });
  }
}
