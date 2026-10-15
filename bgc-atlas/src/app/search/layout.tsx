import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Search',
  description:
    'Search BGC Atlas via sequence similarity (MMseqs2 / DIAMOND), BiG-SLiCE BGC matching, or browse history.',
  alternates: { canonical: '/search' },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
