import type { Metadata } from 'next';
import { SHARE_DESCRIPTION, SITE_NAME } from '@/components/seo/share-metadata';
import { getCorpusFigures, millions } from '@/lib/corpus-figures';

// A route group so the canonical applies to "/" only; set in the root layout it
// would be inherited by every route.
//
// The share text carries the corpus totals, read from the database at build time
// (the page is prerendered). A failed read falls back to text without them
// rather than failing the build.
export async function generateMetadata(): Promise<Metadata> {
  let description = SHARE_DESCRIPTION;
  try {
    const f = await getCorpusFigures();
    description =
      `${millions(f.bgcs)} biosynthetic gene clusters from metagenomes and genomes, ` +
      `in ${f.families.toLocaleString('en-US')} families, with taxonomy and environment. ` +
      'Browse, search and download.';
  } catch (error) {
    console.error('Corpus figures for the share text failed', error);
  }
  return {
    alternates: { canonical: '/' },
    openGraph: { type: 'website', siteName: SITE_NAME, title: SITE_NAME, description, url: '/' },
    twitter: { card: 'summary_large_image', title: SITE_NAME, description },
  };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
