import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Contribute',
  description:
    'Contribute your samples and metadata to BGC Atlas. Submit metadata files and track curation status.',
  alternates: { canonical: '/contribute' },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
