import type { Metadata } from 'next';

interface SampleDetailLayoutProps {
  params: Promise<{ id: string }>;
}

// Without its own canonical this route inherits the root's `canonical: '/'`.
export async function generateMetadata({
  params,
}: SampleDetailLayoutProps): Promise<Metadata> {
  const { id } = await params;
  return {
    title: 'Sample',
    alternates: { canonical: `/samples/${id}` },
  };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
