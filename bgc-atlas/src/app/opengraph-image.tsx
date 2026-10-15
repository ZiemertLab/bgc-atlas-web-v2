import { ImageResponse } from 'next/og';
import { OgCard, OG_SIZE, OG_CONTENT_TYPE, loadFonts } from '@/components/seo/og-card';

// Site-wide fallback; segments with their own opengraph-image override it.
export const alt = 'BGC Atlas — biosynthetic gene clusters with taxonomic and environmental context';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  return new ImageResponse(
    (
      <OgCard
        title="Biosynthetic gene clusters at scale"
        subtitle="16.0 million BGCs from metagenomes, MAGs, single-amplified and isolate genomes, in 614,215 families"
      />
    ),
    { ...size, fonts: await loadFonts() }
  );
}
