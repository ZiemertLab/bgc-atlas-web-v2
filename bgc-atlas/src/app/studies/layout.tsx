import type { Metadata } from 'next';

export const metadata: Metadata = {
  // A plain-string title would consume the root's template and leave detail pages without the suffix.
  title: { default: 'Studies', template: '%s | BGC Atlas' },
  description:
    'Browse the published studies and projects behind the BGC Atlas — every sample that belongs to one, with its biosynthetic gene cluster counts, gene cluster family coverage, and the families found only in that study.',
  keywords: [
    'metagenome studies',
    'BioProject',
    'biosynthetic gene clusters',
    'gene cluster families',
    'study-exclusive GCFs',
    'metagenomics',
  ],
  alternates: { canonical: '/studies' },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
