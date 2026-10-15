import { ImageResponse } from 'next/og';
import { OgCard, OG_SIZE, OG_CONTENT_TYPE, loadFonts } from '@/components/seo/og-card';
import { loadBgc, bgcLabel, bgcKb } from '@/lib/entity-loaders';

export const alt = 'Biosynthetic gene cluster in BGC Atlas';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await loadBgc(id);
  const row = result.status === 'ok' ? result.row : null;

  return new ImageResponse(
    (
      <OgCard
        eyebrow="Biosynthetic gene cluster"
        title={row ? bgcLabel(row) : 'Biosynthetic gene cluster'}
        subtitle={
          row
            ? `${bgcKb(row).toLocaleString()} kb${row.contig ? ` · contig ${row.contig}` : ''}`
            : undefined
        }
      />
    ),
    { ...size, fonts: await loadFonts() }
  );
}
