import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Genome Collections',
  description:
    'Curated collections of genomes (isolates, MAGs, SAGs) integrated into BGC Atlas with associated BGCs.',
  alternates: { canonical: '/genome-collections' },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
