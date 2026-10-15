'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@/lib/api-client';
import { CURRENT_CLUSTERING, GCF_NAME_RE } from '@/lib/clustering';
import type { RetiredFamily } from '@/lib/gcf-legacy';

/** A name of a replaced clustering (any GCF name not carrying the current tag), or a two-word alias. */
function mayBeRetired(query: string): boolean {
  const q = query.trim();
  if (GCF_NAME_RE.test(q)) return !q.toLowerCase().startsWith(`gcf-${CURRENT_CLUSTERING.tag}-`);
  return /^[a-z]+-[a-z]+$/i.test(q);
}

/**
 * Under the /gcfs search: when the reader types the name (or alias) of a family from a replaced clustering,
 * say so and link its page, which lists where its members went. Renders nothing otherwise.
 */
export function RetiredFamilyHint({ query }: { query: string }) {
  const enabled = mayBeRetired(query);
  const { data } = useQuery({
    queryKey: ['gcfs', 'retired', query.trim().toLowerCase()],
    queryFn: () => apiGet<{ retired: RetiredFamily | null }>(`/api/gcfs/retired?name=${encodeURIComponent(query.trim())}`),
    enabled,
    staleTime: 60 * 60 * 1000,
  });
  const family = enabled ? data?.retired : null;
  if (!family) return null;
  return (
    <p className="mb-3 text-[13px] text-muted-foreground">
      <span className="font-mono text-foreground">{family.name}</span>
      {family.petName && <> ({family.petName})</>} is a family of {family.clusteringLabel}, replaced in{' '}
      <span className="font-mono">{CURRENT_CLUSTERING.release}</span>.{' '}
      <Link href={`/gcfs/${family.id}`} className="text-foreground underline underline-offset-4">
        See where its members went
      </Link>
      .
    </p>
  );
}
