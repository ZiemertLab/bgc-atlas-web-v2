import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { withShare } from '@/components/seo/share-metadata';
import { isValidUuid } from '@/lib/entity-loaders';

interface SampleDetailLayoutProps {
  params: Promise<{ id: string }>;
}

// Without its own canonical this route inherits the root's `canonical: '/'`. It renders
// only when the lookup below failed, and then it is not the sample's page, so it is not indexed.
export async function generateMetadata({
  params,
}: SampleDetailLayoutProps): Promise<Metadata> {
  const { id } = await params;
  // No sample is loaded here, so the share text is generic -- but it must be
  // said, or the /samples list's "Browse and explore…" fills the gap.
  return withShare(
    {
      title: 'Sample',
      alternates: { canonical: `/samples/${id.toLowerCase()}` },
      robots: { index: false, follow: true },
    },
    'A sample and its biosynthetic gene clusters.',
  );
}

const GENOME_SOURCE_TYPES = new Set(['isolate', 'MAG', 'SAG']);

/**
 * /samples/<id> is an alias: a sample's page is its list, filtered to it. The client
 * page made that hop after the response had started, so every id -- real or not --
 * answered 200 with an indexable canonical of its own. Decided here it is a 308 to
 * the list the sample belongs on, or a real 404. A database error falls through to
 * the client page, which still redirects, rather than telling crawlers it is gone.
 */
export default async function Layout({ params, children }: SampleDetailLayoutProps & { children: React.ReactNode }) {
  const { id } = await params;
  if (!isValidUuid(id)) notFound();

  let sourceTypes: string[] | null | undefined;
  try {
    const rows = await prisma.$queryRaw<{ source_types: string[] | null }[]>(Prisma.sql`
      SELECT source_types FROM sample_summary WHERE id = ${id.toLowerCase()}::uuid LIMIT 1
    `);
    sourceTypes = rows.length > 0 ? rows[0].source_types ?? [] : null;
  } catch (error) {
    console.error(`Sample lookup failed for ${id}:`, error);
  }
  if (sourceTypes === null) notFound();
  if (sourceTypes) {
    const base = sourceTypes.some((t) => GENOME_SOURCE_TYPES.has(t)) ? '/genome-collections' : '/samples';
    permanentRedirect(`${base}?id=${encodeURIComponent(id.toLowerCase())}`);
  }
  return children;
}
