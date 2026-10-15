import { NextResponse } from 'next/server';

import { serverError } from '@/lib/api/errors';
import { findRetiredFamily } from '@/lib/gcf-legacy';

/**
 * GET /api/gcfs/retired?name=GCF-000042 (or a pet name, or a uuid): the family of a replaced clustering by
 * that name, with where its members went; `{ retired: null }` when there is none. The /gcfs search uses it to
 * point a reader typing an old name at its page.
 */
export async function GET(request: Request) {
  const name = new URL(request.url).searchParams.get('name') ?? '';
  if (name.trim().length < 3 || name.length > 200) {
    return NextResponse.json({ retired: null });
  }
  try {
    const retired = await findRetiredFamily(name);
    return NextResponse.json({ retired }, { headers: { 'Cache-Control': 'public, s-maxage=3600' } });
  } catch (error) {
    return serverError(error, 'Failed to look up the family');
  }
}
