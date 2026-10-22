import type { Metadata } from 'next';
import { withShare } from '@/components/seo/share-metadata';

// Expires with the job, so nothing to index; `follow` stays on for outbound links.
export const metadata: Metadata = withShare({
  title: 'Search results',
  robots: { index: false, follow: true },
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
