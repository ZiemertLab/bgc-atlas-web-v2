import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Export job',
  description: 'Track the status of a BGC GenBank archive export job.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
