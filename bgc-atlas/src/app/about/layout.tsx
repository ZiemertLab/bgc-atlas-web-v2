import type { Metadata } from 'next';
import { withShare } from '@/components/seo/share-metadata';

export const metadata: Metadata = withShare({
  title: 'About',
  description:
    'What BGC Atlas contains, the data sources it draws on, how BGCs were detected and clustered, and the terms for reusing the data.',
  alternates: { canonical: '/about' },
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
