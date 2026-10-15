'use client';

import Link from 'next/link';

import { useReleases } from '@/lib/releases/use-releases';

/**
 * "Data release R2.0-beta.1" in the footer: which release the site's data is; links to what changed in it.
 * Renders nothing until the release is known, or if it cannot be read.
 */
export function DataReleaseLink() {
  const { data } = useReleases();
  const id = data?.latest?.id;
  if (!id) return null;
  return (
    <>
      {' '}·{' '}
      <Link href="/releases" className="underline-offset-4 hover:underline hover:text-foreground">
        Data release <span className="font-mono">{id}</span>
      </Link>
    </>
  );
}
