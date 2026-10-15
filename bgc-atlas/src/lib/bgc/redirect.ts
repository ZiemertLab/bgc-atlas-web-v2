import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// Never throws: a failed lookup means "no redirect" and the caller 404s.
export async function findBgcRedirect(id: string): Promise<string | null> {
  try {
    const rows = await prisma.$queryRaw<{ twin: string }[]>`
      SELECT twin_bgc_id::text AS twin FROM bgc_redirect WHERE old_bgc_id = ${id}::uuid`;
    return rows[0]?.twin ?? null;
  } catch {
    return null;
  }
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://bgc-atlas.cs.uni-tuebingen.de';

// Relative Location: behind nginx `request.url` carries the upstream host.
export function redirectToTwin(url: URL): NextResponse {
  const location = url.pathname + url.search;
  return NextResponse.json(
    {
      success: false,
      redirect: location,
      reason: 'This BGC id was removed on 2026-10-05 (its assembly had been loaded twice); '
        + 'the same region is at the redirect. Every removed id and its replacement: '
        + `${SITE_URL}/downloads/bgc_id_redirects.tsv.gz`,
    },
    { status: 308, headers: { Location: location } },
  );
}
