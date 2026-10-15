import { bgcKnownClusterHits, gcfKnownClusterRollup, KNOWNCLUSTER_MIN_FAMILY_COVERAGE } from '@/lib/opensearch/client';

/**
 * KnownClusterBLAST decorations for list rows, from bgc_facets. List routes serve the
 * page without them if the lookup fails; streamed exports pass `strict` and fail, since
 * an offline file cannot show a column went blank because of a timeout.
 */
interface DecorationOptions { strict?: boolean }

/** The BGC's own top hit, null below the 50% similarity cutoff. */
export async function withKnownClusterHits<T extends { id: string }>(
  rows: T[], { strict = false }: DecorationOptions = {},
) {
  try {
    const hits = await bgcKnownClusterHits(rows.map((r) => r.id));
    return rows.map((r) => ({ ...r, knownCluster: hits.get(r.id) ?? null }));
  } catch (error) {
    if (strict) throw error;
    console.error('KnownClusterBLAST lookup failed; rows served without it', error);
    return rows.map((r) => ({ ...r, knownCluster: null }));
  }
}

/**
 * Attach the dominant qualifying KnownClusterBLAST compound to a page of GCF rows.
 * Similarity (gcfKnownClusterRollup) asks whether a hit is real; coverage, applied here,
 * whether it speaks for the family (12 perfect hits in 54,956 members does not).
 */
export async function withKnownClusterRollup<T extends { id: string; memberBgcCount: number }>(
  rows: T[], { strict = false }: DecorationOptions = {},
) {
  try {
    const rollup = await gcfKnownClusterRollup(rows.map((r) => r.id));
    return rows.map((r) => {
      const hit = rollup.get(r.id);
      if (!hit || r.memberBgcCount <= 0) return { ...r, knownCluster: null };
      const coverage = (100 * hit.hitCount) / r.memberBgcCount;
      if (coverage < KNOWNCLUSTER_MIN_FAMILY_COVERAGE) return { ...r, knownCluster: null };
      // Coverage travels with the compound, so the reader does not assume the whole family.
      return { ...r, knownCluster: { ...hit, coverage } };
    });
  } catch (error) {
    if (strict) throw error;
    console.error('KnownClusterBLAST rollup failed; rows served without it', error);
    return rows.map((r) => ({ ...r, knownCluster: null }));
  }
}
