import type { Metadata } from 'next';

/**
 * The tags a link preview reads: og:* for WhatsApp, Slack, Teams, Facebook and
 * LinkedIn, twitter:* for X.
 *
 * Next copies the root layout's openGraph down to any segment that sets none of
 * its own, so every GCF, BGC and study page used to share as the homepage --
 * the homepage's title and description, and og:url pointing at the homepage.
 * Only the image was page-specific. A segment that sets openGraph replaces the
 * parent's object whole, so each one passes through here.
 */

export const SITE_NAME = 'BGC Atlas';

/** The fallback for routes with nothing better to say. No figures: they go stale. */
export const SHARE_DESCRIPTION =
  'Biosynthetic gene clusters from metagenomes and genomes, grouped into families, with taxonomy and environment. Browse, search and download.';

function titleText(title: Metadata['title']): string | undefined {
  if (!title) return undefined;
  if (typeof title === 'string') return title;
  if ('absolute' in title) return title.absolute;
  return title.default;
}

function canonicalUrl(meta: Metadata): string | URL | undefined {
  const canonical = meta.alternates?.canonical;
  if (typeof canonical === 'string' || canonical instanceof URL) return canonical;
  return canonical?.url;
}

/**
 * The site card from app/opengraph-image.tsx. Named explicitly because Next
 * carries a file-based image down only one segment: /samples/[id] under a
 * /samples layout that sets openGraph had no image at all. A segment with its
 * own opengraph-image file still overrides this.
 */
const SITE_IMAGE = { url: '/opengraph-image', width: 1200, height: 630, type: 'image/png', alt: SITE_NAME };

/**
 * `meta` plus share tags derived from it: the tab title with the site suffix, the
 * page's own canonical as og:url, and `description` (else the page's own).
 */
export function withShare(meta: Metadata, description?: string): Metadata {
  const page = titleText(meta.title);
  const title = page ? `${page} | ${SITE_NAME}` : SITE_NAME;
  const text = description ?? (typeof meta.description === 'string' ? meta.description : undefined);
  return {
    ...meta,
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      title,
      description: text,
      url: canonicalUrl(meta),
      images: [SITE_IMAGE],
    },
    // No images: Next falls back to og:image, which is the page's own card when it has one.
    twitter: { card: 'summary_large_image', title, description: text },
  };
}
