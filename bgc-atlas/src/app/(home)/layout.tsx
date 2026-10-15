import type { Metadata } from 'next';

// A route group so the canonical applies to "/" only; set in the root layout it
// would be inherited by every route.
export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
