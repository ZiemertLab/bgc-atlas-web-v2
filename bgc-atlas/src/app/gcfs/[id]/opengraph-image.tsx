import { ImageResponse } from 'next/og';
import { OgCard, OG_SIZE, OG_CONTENT_TYPE, loadFonts } from '@/components/seo/og-card';
import { loadGcf, gcfName, plural, resolveGcfId } from '@/lib/entity-loaders';

export const alt = 'Gene cluster family in BGC Atlas';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  // The page redirects a name URL to the uuid one; a card fetched by name
  // directly resolves the same way rather than falling back to the generic card.
  const id = (await resolveGcfId((await params).id)) ?? (await params).id;
  const result = await loadGcf(id);
  const row = result.status === 'ok' ? result.row : null;

  // An unresolved family still gets a card rather than a broken image.
  const title = row
    ? row.pet_name
      ? `${gcfName(row, id)} · ${row.pet_name}`
      : gcfName(row, id)
    : 'Gene cluster family';
  const subtitle = row
    ? plural(row.member_bgc_count, 'member BGC', 'member BGCs')
    : undefined;

  return new ImageResponse(<OgCard eyebrow="Gene cluster family" title={title} subtitle={subtitle} />, {
    ...size,
    fonts: await loadFonts(),
  });
}
