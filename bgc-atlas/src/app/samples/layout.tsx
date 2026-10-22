import type { Metadata } from 'next';
import { withShare } from '@/components/seo/share-metadata';

export const metadata: Metadata = withShare({
  title: 'Metagenomes',
  description:
    'Browse and explore metagenomic samples from diverse environmental sources, with assembly, biome, and BGC counts.',
  alternates: { canonical: '/samples' },
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
