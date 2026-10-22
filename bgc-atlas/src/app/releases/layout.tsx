import type { Metadata } from 'next';
import { withShare } from '@/components/seo/share-metadata';

export const metadata: Metadata = withShare({
  title: 'Data releases',
  description:
    'What changed in each BGC Atlas data release: counts, BGC ids added and removed, files, and notes.',
  alternates: { canonical: '/releases' },
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
