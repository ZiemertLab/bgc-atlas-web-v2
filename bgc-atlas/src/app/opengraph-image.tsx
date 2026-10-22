import { ImageResponse } from 'next/og';
import { OgCard, OG_SIZE, OG_CONTENT_TYPE, loadFonts } from '@/components/seo/og-card';
import { getCorpusFigures, millions } from '@/lib/corpus-figures';

// Site-wide fallback; segments with their own opengraph-image override it.
export const alt = 'BGC Atlas — biosynthetic gene clusters from metagenomes and genomes';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
// The totals come from the database; written in by hand they went stale.
export const revalidate = 3600;

export default async function Image() {
  const f = await getCorpusFigures();
  return new ImageResponse(
    (
      <OgCard
        title={`${millions(f.bgcs)} biosynthetic gene clusters`}
        subtitle={`from metagenomes, MAGs, single-amplified and isolate genomes, in ${f.families.toLocaleString('en-US')} families`}
      />
    ),
    { ...size, fonts: await loadFonts() }
  );
}
