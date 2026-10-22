import type { Metadata } from 'next';
import { withShare } from '@/components/seo/share-metadata';

export const metadata: Metadata = withShare({
  title: 'Genome Collections',
  description:
    'Curated collections of genomes (isolates, MAGs, SAGs) integrated into BGC Atlas with associated BGCs.',
  alternates: { canonical: '/genome-collections' },
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
