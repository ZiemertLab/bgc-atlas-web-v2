import { NextRequest, NextResponse } from 'next/server';
import { aggregateBrowseIndex, isBrowseSearchEnabled } from '@/lib/opensearch/browse-client';
import { buildBrowseFilters, supportsBrowseSearch } from '@/lib/opensearch/browse-query';
import { buildGcfDistributionRequest, parseGcfDistributionResponse } from '@/lib/opensearch/gcf-distribution';
import { filterRefusalResponse } from '@/lib/api/filter-refusal';
import { serverError } from '@/lib/api/errors';

export const dynamic = 'force-dynamic';

// GET /api/gcfs/distribution?<any /gcfs table filter>
// Returns: GcfDistributionResult, or { supported: false, reason } when this
// filter set cannot be answered from the browse index.
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;

  // An unsupported filter set returns `supported: false` and the caller falls
  // back to the labelled corpus-wide snapshot.
  if (!isBrowseSearchEnabled('gcfs')) {
    return NextResponse.json({ supported: false, reason: 'browse-index-disabled' });
  }
  if (!supportsBrowseSearch('gcfs', params)) {
    return NextResponse.json({ supported: false, reason: 'unsupported-filters' });
  }

  try {
    const filters = buildBrowseFilters('gcfs', params);
    const response = await aggregateBrowseIndex('gcfs', buildGcfDistributionRequest(filters));
    const result = parseGcfDistributionResponse(response);
    if (result.truncated) {
      // member_bgc_count cardinality is ~2,000 against a size of 5,000: the rank plot is losing its tail.
      console.warn('[api/gcfs/distribution] terms agg truncated');
    }
    return NextResponse.json({ supported: true, ...result });
  } catch (err) {
    // ?study= is force-supported (the SQL fallback has no study filter), so a
    // refused filter can arrive here; and supportsAdvancedBrowse never checks
    // values. A refusal must be a 400, or the caller's outage fallback would
    // silently show every family.
    const refusal = filterRefusalResponse(err);
    if (refusal) return refusal;
    return serverError(err, '[api/gcfs/distribution]', { status: 502 });
  }
}
