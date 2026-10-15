import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Metagenomes',
  description:
    'Browse and explore metagenomic samples from diverse environmental sources, with assembly, biome, and BGC counts.',
  alternates: { canonical: '/samples' },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
