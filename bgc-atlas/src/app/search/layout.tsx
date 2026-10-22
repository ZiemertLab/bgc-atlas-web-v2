import type { Metadata } from 'next';
import { withShare } from '@/components/seo/share-metadata';

export const metadata: Metadata = withShare({
  title: 'Search',
  description:
    'Search BGC Atlas via sequence similarity (MMseqs2 / DIAMOND), BiG-SLiCE BGC matching, or browse history.',
  alternates: { canonical: '/search' },
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
