import type { Metadata } from 'next';
import { withShare } from '@/components/seo/share-metadata';

export const metadata: Metadata = withShare({
  title: 'Contribute',
  description:
    'Contribute your samples and metadata to BGC Atlas. Submit metadata files and track curation status.',
  alternates: { canonical: '/contribute' },
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
