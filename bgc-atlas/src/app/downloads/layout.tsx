import type { Metadata } from 'next';
import { withShare } from '@/components/seo/share-metadata';

export const metadata: Metadata = withShare({
  title: 'Downloads',
  description:
    'Bulk downloads of BGC Atlas datasets — BGC GenBank archives, sample metadata, and statistics tables.',
  alternates: { canonical: '/downloads' },
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
