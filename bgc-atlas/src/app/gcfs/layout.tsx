import type { Metadata } from 'next';

export const metadata: Metadata = {
  // A plain-string title consumes the root's template, so detail pages would lose the suffix.
  title: { default: 'Gene Cluster Families (GCFs)', template: '%s | BGC Atlas' },
  description:
    'Explore gene cluster families (GCFs) — groups of related biosynthetic gene clusters (BGCs) that likely encode similar natural products and secondary metabolites — with member counts, structural and functional characteristics, and ecosystem distributions.',
  keywords: [
    'gene cluster families',
    'GCF',
    'GCFs',
    'biosynthetic gene clusters',
    'BGCs',
    'natural products',
    'secondary metabolites',
    'BiG-SLiCE',
  ],
  alternates: { canonical: '/gcfs' },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
