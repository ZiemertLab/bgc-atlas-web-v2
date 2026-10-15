import type { Metadata } from 'next';

// Expires with the job, so nothing to index; `follow` stays on for outbound links.
export const metadata: Metadata = {
  title: 'Search results',
  robots: { index: false, follow: true },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
