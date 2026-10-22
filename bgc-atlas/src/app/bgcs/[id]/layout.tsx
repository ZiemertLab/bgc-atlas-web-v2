import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { findBgcRedirect } from '@/lib/bgc/redirect';
import { JsonLd } from '@/components/seo/json-ld';
import { withShare } from '@/components/seo/share-metadata';
import { entityDataset } from '@/lib/structured-data';
import {
  isValidUuid,
  loadBgc,
  bgcLabel,
  bgcKb,
  bgcProducts,
  bgcDescription,
  bgcShareDescription,
} from '@/lib/entity-loaders';

// page.tsx is a client component and so cannot export metadata.

interface BgcDetailLayoutProps {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}

// Every return carries its own canonical, or these pages inherit '/bgcs' and read
// as duplicates of the list. Missing ids are noindexed; DB errors are not, so an
// outage cannot deindex real pages.
export async function generateMetadata({ params }: BgcDetailLayoutProps): Promise<Metadata> {
  const { id } = await params;
  const alternates = { canonical: `/bgcs/${id}` };
  if (!isValidUuid(id)) {
    return withShare({ title: 'Biosynthetic gene cluster', robots: { index: false, follow: true } });
  }

  const result = await loadBgc(id);
  if (result.status === 'missing') {
    return withShare({ title: 'Biosynthetic gene cluster', robots: { index: false, follow: true } });
  }
  if (result.status === 'error') return withShare({ title: 'Biosynthetic gene cluster', alternates });

  const { row } = result;
  // Contig names run to 60+ characters of assembler boilerplate; keep the head.
  const contig = row.contig && row.contig.length > 26 ? `${row.contig.slice(0, 26)}…` : row.contig;
  return withShare(
    {
      alternates,
      title: contig ? `${bgcLabel(row)} · ${contig}` : `${bgcLabel(row)} · ${id.slice(0, 8)}`,
      description: bgcDescription(row),
    },
    bgcShareDescription(row),
  );
}

export default async function Layout({ params, children }: BgcDetailLayoutProps) {
  const { id } = await params;
  // One URL per BGC: an uppercase id served the page under a second, uppercase canonical.
  if (isValidUuid(id) && id !== id.toLowerCase()) permanentRedirect(`/bgcs/${id.toLowerCase()}`);
  const result = await loadBgc(id);
  // A removed duplicate is the same region under its twin's id; redirect rather than 404.
  if (result.status === 'missing') {
    const twin = isValidUuid(id) ? await findBgcRedirect(id) : null;
    if (twin) permanentRedirect(`/bgcs/${twin}`);
    // Decided here, before streaming, so it is a real 404: the client page's
    // notFound() ran after the response had started, and an unknown id was a 200.
    // Only for 'missing' -- a database error must not tell crawlers a BGC is gone.
    notFound();
  }
  const row = result.status === 'ok' ? result.row : null;

  return (
    <>
      {row && (
        <JsonLd
          data={entityDataset({
            path: `/bgcs/${id}`,
            identifier: id,
            name: row.contig ? `${bgcLabel(row)} · ${row.contig}` : `${bgcLabel(row)} · ${id.slice(0, 8)}`,
            description: bgcDescription(row),
            keywords: [
              'biosynthetic gene cluster',
              'natural products',
              ...bgcProducts(row),
            ],
            variables: [
              { name: 'Length (kb)', value: bgcKb(row) },
              ...(bgcProducts(row).length
                ? [{ name: 'Products', value: bgcProducts(row).join(', ') }]
                : []),
              ...(row.contig ? [{ name: 'Contig', value: row.contig }] : []),
            ],
          })}
        />
      )}
      {children}
    </>
  );
}
