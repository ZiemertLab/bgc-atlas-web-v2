import { NextResponse } from 'next/server';

import { BROWSE_RESULT_WINDOW } from '@/lib/opensearch/deep-paging';

// Backstop for deep offsets the PostgreSQL fallback cannot serve: they hold a connection until
// the statement timeout and then 500. If this fires for ordinary browsing, check OpenSearch.
export const deepPageRefusal = (offset: number, limit: number): NextResponse | null => {
  if (offset + limit <= BROWSE_RESULT_WINDOW) return null;

  // Same text in `error` and `message`: browse pages each read only one of them.
  const message = `Cannot page past result ${BROWSE_RESULT_WINDOW.toLocaleString()} for this query. `
    + 'Narrow your filters or change the sort, then page again.';

  return NextResponse.json(
    { success: false, error: message, message, rejected: [] },
    { status: 400 },
  );
};
