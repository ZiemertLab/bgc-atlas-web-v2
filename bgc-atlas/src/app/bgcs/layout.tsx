import type { Metadata } from 'next';
import { withShare } from '@/components/seo/share-metadata';

export const metadata: Metadata = withShare({
  // A plain-string title would consume the root's template and leave detail pages without the suffix.
  title: { default: 'Biosynthetic Gene Clusters (BGCs)', template: '%s | BGC Atlas' },
  description:
    'Browse biosynthetic gene clusters (BGCs) — the genomic loci encoding microbial natural products and secondary metabolites — with gene counts, products, taxonomy, biome assignments, and links to gene cluster families (GCFs).',
  keywords: [
    'biosynthetic gene clusters',
    'BGC',
    'BGCs',
    'natural products',
    'secondary metabolites',
    'gene cluster families',
    'antiSMASH',
  ],
  alternates: { canonical: '/bgcs' },
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
