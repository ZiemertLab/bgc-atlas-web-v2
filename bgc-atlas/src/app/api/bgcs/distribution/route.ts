import { NextRequest, NextResponse } from 'next/server';
import { aggregateBrowseIndex, isBrowseSearchEnabled } from '@/lib/opensearch/browse-client';
import { buildBrowseFilters, supportsBrowseSearch } from '@/lib/opensearch/browse-query';
import {
  buildDistributionRequest, isDistributionVariant, parseDistributionResponse,
} from '@/lib/opensearch/bgc-distribution';
import { filterRefusalResponse } from '@/lib/api/filter-refusal';
import { serverError } from '@/lib/api/errors';

export const dynamic = 'force-dynamic';

// GET /api/bgcs/distribution?variant=gold_level_1&<any /bgcs table filter>
// Returns: DistributionResult, or { supported: false, reason } when this filter
// set cannot be answered from the browse index.
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;

  const variant = params.get('variant') ?? 'gold_level_1';
  if (!isDistributionVariant(variant)) {
    return NextResponse.json({ error: `unknown distribution variant: ${variant}` }, { status: 400 });
  }

  // An unsupported filter set returns `supported: false` and the caller falls
  // back to the labelled corpus-wide snapshot; never return unfiltered bars as filtered.
  if (!isBrowseSearchEnabled('bgcs')) {
    return NextResponse.json({ supported: false, reason: 'browse-index-disabled' });
  }
  if (!supportsBrowseSearch('bgcs', params)) {
    return NextResponse.json({ supported: false, reason: 'unsupported-filters' });
  }

  try {
    const filters = buildBrowseFilters('bgcs', params);
    // ?classes=1 adds the antiSMASH-class tallies for the Class view; off by
    // default because that agg costs as much as the rest of the request.
    const withClasses = params.get('classes') === '1';
    const response = await aggregateBrowseIndex('bgcs', buildDistributionRequest(variant, filters, { withClasses }));
    const result = parseDistributionResponse(variant, response);
    if (result.truncated) {
      // Max cardinality is ~5,000 against a size of 10,000: `Others` is under-counting.
      console.warn(`[api/bgcs/distribution] terms agg truncated for variant=${variant}`);
    }
    return NextResponse.json({ supported: true, ...result });
  } catch (err) {
    // supportsAdvancedBrowse never checks a value, so `genes gte "many"` reaches
    // the builder: a refused filter is a 400; the 502 is for a real outage.
    const refusal = filterRefusalResponse(err);
    if (refusal) return refusal;
    return serverError(err, '[api/bgcs/distribution]', { status: 502 });
  }
}
