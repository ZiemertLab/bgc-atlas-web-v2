import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { JsonLd } from '@/components/seo/json-ld';
import { withShare } from '@/components/seo/share-metadata';
import { entityDataset } from '@/lib/structured-data';
import {
  isValidUuid,
  loadGcf,
  resolveGcfId,
  gcfName,
  gcfDescription,
  gcfShareDescription,
  gcfStructuredDescription,
} from '@/lib/entity-loaders';

interface GcfDetailLayoutProps {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}

// Each page needs its own canonical, or it inherits '/gcfs'. Missing ids are
// noindexed, but DB errors are not, so an outage cannot deindex real pages.
export async function generateMetadata({ params }: GcfDetailLayoutProps): Promise<Metadata> {
  const { id } = await params;
  const alternates = { canonical: `/gcfs/${id}` };
  if (!isValidUuid(id)) {
    await redirectByName(id);
    return withShare({ title: 'Gene Cluster Family', robots: { index: false, follow: true } });
  }

  const result = await loadGcf(id);
  if (result.status === 'missing') {
    return withShare({ title: 'Gene Cluster Family', robots: { index: false, follow: true } });
  }
  if (result.status === 'error') return withShare({ title: 'Gene Cluster Family', alternates });

  const { row } = result;
  const name = gcfName(row, id);
  return withShare(
    {
      alternates,
      title: row.pet_name ? `${name} · ${row.pet_name}` : name,
      description: gcfDescription(row, id),
    },
    gcfShareDescription(row),
  );
}

/**
 * /gcfs/GCF-v2b6-000001 and /gcfs/<pet name> send the reader to the family's uuid
 * URL, where the page, title and social card all resolve; an old family's name
 * goes to its uuid, which shows where its members went. Throws (as Next's redirect
 * does) when the name matches; returns when it does not.
 */
async function redirectByName(id: string) {
  const uuid = await resolveGcfId(id);
  if (uuid) permanentRedirect(`/gcfs/${uuid}`);
}

/**
 * Whether no family, current or retired, has this id. The client page decides "not
 * found" only after the response has started, so every unknown family -- a
 * mistyped uuid, a name from the dropped v2b5 clustering -- was served with a 200.
 * Answered here, before streaming, it is a real 404. A database error is NOT a
 * 404: one bad minute must not tell crawlers that real families are gone.
 */
async function isUnknownFamily(id: string): Promise<boolean> {
  if (!isValidUuid(id)) return true;
  try {
    const [row] = await prisma.$queryRaw<{ known: boolean }[]>(Prisma.sql`
      SELECT EXISTS (SELECT 1 FROM gcfs WHERE id = ${id}::uuid)
          OR EXISTS (SELECT 1 FROM gcf_legacy WHERE gcf_id = ${id}::uuid) AS known
    `);
    return row ? !row.known : false;
  } catch (error) {
    console.error(`Family lookup failed for ${id}:`, error);
    return false;
  }
}

export default async function Layout({ params, children }: GcfDetailLayoutProps) {
  const { id } = await params;
  if (!isValidUuid(id)) await redirectByName(id);
  // One URL per family: an uppercase id served the page under a second, uppercase canonical.
  if (isValidUuid(id) && id !== id.toLowerCase()) permanentRedirect(`/gcfs/${id.toLowerCase()}`);
  const result = await loadGcf(id);
  if (result.status === 'missing' && (await isUnknownFamily(id))) notFound();
  const row = result.status === 'ok' ? result.row : null;

  return (
    <>
      {row && (
        <JsonLd
          data={entityDataset({
            path: `/gcfs/${id}`,
            identifier: id,
            name: gcfName(row, id),
            alternateName: row.pet_name,
            description: gcfStructuredDescription(row, id),
            keywords: [
              'gene cluster family',
              'GCF',
              'BiG-SLiCE',
              'natural products',
              ...(row.product_categories ?? []),
            ],
            variables: [{ name: 'Member BGCs', value: row.member_bgc_count }],
          })}
        />
      )}
      {children}
    </>
  );
}
