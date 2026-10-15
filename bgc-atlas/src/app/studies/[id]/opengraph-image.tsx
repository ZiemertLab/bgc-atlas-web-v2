import { ImageResponse } from 'next/og';
import { OgCard, OG_SIZE, OG_CONTENT_TYPE, loadFonts } from '@/components/seo/og-card';
import { loadStudy, studyName, plural } from '@/lib/entity-loaders';

export const alt = 'Study in BGC Atlas';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await loadStudy(id);
  const row = result.status === 'ok' ? result.row : null;

  // Never the abstract: a card has no room for the credit line its licence asks for.
  return new ImageResponse(
    (
      <OgCard
        eyebrow="Study"
        title={row ? studyName(row) : 'Study'}
        subtitle={
          row
            ? `${plural(row.sample_count, 'sample', 'samples')} · ${plural(row.total_bgcs, 'biosynthetic gene cluster', 'biosynthetic gene clusters')}`
            : undefined
        }
      />
    ),
    { ...size, fonts: await loadFonts() }
  );
}
