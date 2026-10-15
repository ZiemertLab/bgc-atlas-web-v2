import { NextRequest, NextResponse } from 'next/server';
import { aggregateBrowseIndex, isBrowseSearchEnabled } from '@/lib/opensearch/browse-client';
import { buildBrowseFilters, supportsBrowseSearch } from '@/lib/opensearch/browse-query';
import { isTaxonomyRank } from '@/lib/opensearch/taxonomy-composition';
import {
  buildGcfCompositionRequest, isPurityCutoff, parseGcfCompositionResponse,
} from '@/lib/opensearch/gcf-taxonomy-composition';
import { filterRefusalResponse } from '@/lib/api/filter-refusal';
import { serverError } from '@/lib/api/errors';

export const dynamic = 'force-dynamic';

// GET /api/gcfs/taxonomy-composition?rank=phylum&purity=50&<any /gcfs table filter>
// Returns: GcfCompositionResult, or { supported: false, reason }.
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;

  const rank = params.get('rank') ?? 'phylum';
  if (!isTaxonomyRank(rank)) {
    return NextResponse.json({ error: `unknown taxonomic rank: ${rank}` }, { status: 400 });
  }

  const purityParam = params.get('purity') ?? 50;
  if (!isPurityCutoff(purityParam)) {
    return NextResponse.json({ error: `unsupported purity cutoff: ${purityParam}` }, { status: 400 });
  }
  const purity = Number(purityParam) as 50 | 70 | 90;

  if (!isBrowseSearchEnabled('gcfs')) {
    return NextResponse.json({ supported: false, reason: 'browse-index-disabled' });
  }
  // The panel hides rather than summarise a different set than the table's SQL
  // fallback would list. ?study= is force-supported, so the catch must handle
  // whatever else it admits.
  if (!supportsBrowseSearch('gcfs', params)) {
    return NextResponse.json({ supported: false, reason: 'unsupported-filters' });
  }

  try {
    const filters = buildBrowseFilters('gcfs', params);
    const response = await aggregateBrowseIndex('gcfs', buildGcfCompositionRequest(rank, purity, filters));
    return NextResponse.json({ supported: true, ...parseGcfCompositionResponse(rank, purity, response) });
  } catch (err) {
    // A refused filter (reachable via the force-supported ?study=) is a 400; the
    // 502 is for a real outage.
    const refusal = filterRefusalResponse(err);
    if (refusal) return refusal;
    return serverError(err, '[api/gcfs/taxonomy-composition]', { status: 502 });
  }
}
