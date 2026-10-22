import type { Metadata } from 'next';
import { withShare } from '@/components/seo/share-metadata';

export const metadata: Metadata = withShare({
  title: 'Change log',
  description:
    'Release history for BGC Atlas — dataset additions, new analyses, and changes to the web resource.',
  alternates: { canonical: '/changelog' },
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
