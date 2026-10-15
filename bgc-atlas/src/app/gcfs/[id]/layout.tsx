import type { Metadata } from 'next';
import { permanentRedirect } from 'next/navigation';
import { JsonLd } from '@/components/seo/json-ld';
import { entityDataset } from '@/lib/structured-data';
import {
  isValidUuid,
  loadGcf,
  resolveGcfId,
  gcfName,
  gcfDescription,
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
    return { title: 'Gene Cluster Family', robots: { index: false, follow: true } };
  }

  const result = await loadGcf(id);
  if (result.status === 'missing') {
    return { title: 'Gene Cluster Family', robots: { index: false, follow: true } };
  }
  if (result.status === 'error') return { title: 'Gene Cluster Family', alternates };

  const { row } = result;
  const name = gcfName(row, id);
  return {
    alternates,
    title: row.pet_name ? `${name} · ${row.pet_name}` : name,
    description: gcfDescription(row, id),
  };
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

export default async function Layout({ params, children }: GcfDetailLayoutProps) {
  const { id } = await params;
  if (!isValidUuid(id)) await redirectByName(id);
  const result = await loadGcf(id);
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
