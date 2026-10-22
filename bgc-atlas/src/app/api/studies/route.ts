import { NextResponse } from 'next/server';

import { buildListCacheKeys, getOrSetCache } from '@/lib/cache';
import { filterRefusalResponse } from '@/lib/api/filter-refusal';
import {
  buildStudyOrder,
  buildStudyWhere,
  countStudies,
  countUnlistedStudies,
  fetchStudyRows,
  parseIntParam,
} from '@/lib/api/studies-query';
import { serverError } from '@/lib/api/errors';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// The query lives in lib/api/studies-query.ts, shared with /api/studies/export.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = url.searchParams;

  const limit = parseIntParam(params.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = parseIntParam(params.get('offset'), 0, 0);

  let whereClause;
  try {
    whereClause = buildStudyWhere(params);
  } catch (error) {
    const refusal = filterRefusalResponse(error);
    if (refusal) return refusal;
    throw error;
  }
  const orderClause = buildStudyOrder(params);

  // Bump the version on any change to the row set or payload shape; the key
  // carries params verbatim, so removed params need a bump too.
  const { dataKey, countKey } = buildListCacheKeys('studies:list:v10', params, [
    'limit', 'offset', 'sortField', 'sortOrder',
  ]);

  // `unlisted` rides in the count entry: both answer "how many", on the same TTL.
  const fetchTotal = async () => {
    const [total, unlisted] = await Promise.all([
      countStudies(whereClause),
      countUnlistedStudies(params),
    ]);
    return { total, unlisted };
  };
  const fetchData = () => fetchStudyRows(whereClause, orderClause, limit, offset);

  try {
    const [{ total, unlisted }, data] = await Promise.all([
      getOrSetCache(countKey, fetchTotal, 600),
      getOrSetCache(dataKey, fetchData, 300),
    ]);

    return NextResponse.json({
      success: true,
      data: { data, total, unlisted, limit, offset },
    });
  } catch (error) {
    return serverError(error, 'Failed to load studies');
  }
}
