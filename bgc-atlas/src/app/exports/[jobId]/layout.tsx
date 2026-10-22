import type { Metadata } from 'next';
import { withShare } from '@/components/seo/share-metadata';

export const metadata: Metadata = withShare({
  title: 'Export job',
  description: 'Track the status of a BGC GenBank archive export job.',
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
