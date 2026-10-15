'use client';

// antiSMASH homology to a MIBiG cluster: not the same claim as a family's "MIBiG relative",
// and the two are never summed. `weak` is for Property Search only: every other table drops
// hits under the similarity cutoff, but there the hit is what put the row in the result, so it
// stays visible, muted, with a caveat in its tooltip.

import { KNOWNCLUSTER_MIN_SIMILARITY } from '@/lib/known-cluster-thresholds';
import { cn } from '@/lib/utils';

// MIBiG 4.x resolves only versioned accessions (BGC0001615.3); unversioned ones stay unlinked.
const MIBIG_VERSIONED = /^BGC\d{7}\.\d+$/;

export function KnownClusterCell({
  compound,
  accession,
  similarity,
  coverage,
  weak = false,
}: {
  compound: string | null;
  accession: string | null;
  similarity: number;
  /** Family rows only: percent of members carrying the hit. */
  coverage?: number;
  /** Below the similarity cutoff: rendered muted, with a caveat in the tooltip. */
  weak?: boolean;
}) {
  const label = compound ?? accession;
  if (!label) return <span className="text-xs text-muted-foreground">—</span>;

  const href = accession && MIBIG_VERSIONED.test(accession)
    ? `https://mibig.secondarymetabolites.org/repository/${accession}/`
    : null;

  const title = (
    coverage === undefined
      ? `${label}${accession && compound ? ` (${accession})` : ''} — ${similarity}% similar`
      : `${label}${accession && compound ? ` (${accession})` : ''} — carried by `
        + `${coverage.toFixed(1)}% of members, best hit ${similarity}% similar`
  ) + (weak
    ? ` — below the ${KNOWNCLUSTER_MIN_SIMILARITY}% cutoff used elsewhere on the site; likely a chance match`
    : '');

  return (
    <div className="flex min-w-0 items-baseline gap-1.5" title={title}>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'truncate text-xs underline-offset-2 hover:underline',
            weak ? 'text-muted-foreground' : 'text-brand',
          )}
        >
          {label}
        </a>
      ) : (
        <span className={cn('truncate text-xs', weak && 'text-muted-foreground')}>{label}</span>
      )}
      {/* On a family row this is coverage, not similarity. */}
      <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
        {coverage === undefined ? `${Math.round(similarity)}%` : `${coverage.toFixed(coverage < 10 ? 1 : 0)}%`}
      </span>
    </div>
  );
}
