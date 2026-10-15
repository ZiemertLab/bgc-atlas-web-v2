import type { Metadata } from 'next';
import { permanentRedirect } from 'next/navigation';
import { findBgcRedirect } from '@/lib/bgc/redirect';
import { JsonLd } from '@/components/seo/json-ld';
import { entityDataset } from '@/lib/structured-data';
import {
  isValidUuid,
  loadBgc,
  bgcLabel,
  bgcKb,
  bgcProducts,
  bgcDescription,
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
    return { title: 'Biosynthetic gene cluster', robots: { index: false, follow: true } };
  }

  const result = await loadBgc(id);
  if (result.status === 'missing') {
    return { title: 'Biosynthetic gene cluster', robots: { index: false, follow: true } };
  }
  if (result.status === 'error') return { title: 'Biosynthetic gene cluster', alternates };

  const { row } = result;
  // Contig names run to 60+ characters of assembler boilerplate; keep the head.
  const contig = row.contig && row.contig.length > 26 ? `${row.contig.slice(0, 26)}…` : row.contig;
  return {
    alternates,
    title: contig ? `${bgcLabel(row)} · ${contig}` : `${bgcLabel(row)} · ${id.slice(0, 8)}`,
    description: bgcDescription(row),
  };
}

export default async function Layout({ params, children }: BgcDetailLayoutProps) {
  const { id } = await params;
  const result = await loadBgc(id);
  // A removed duplicate is the same region under its twin's id; redirect rather than 404.
  if (result.status === 'missing') {
    const twin = await findBgcRedirect(id);
    if (twin) permanentRedirect(`/bgcs/${twin}`);
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
