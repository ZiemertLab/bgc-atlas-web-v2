/**
 * Per-rank taxonomy on LIST rows, cut to each rank's largest taxa.
 *
 * A large family spans tens of thousands of species: GCF-v2b6-000338 carried
 * 22,103 (702 KB) on one /gcfs row, and the default page weighed 4.08 MB. The
 * list cell draws only taxa ≥5% (at most 20 of them) and fills the rest as
 * "Other", so the top 20 draws the same bar. The untrimmed count travels in
 * `taxaCounts` so the "Other (N taxa)" tooltip stays true. Detail pages and
 * exports read the untrimmed document, not this.
 */
export const TAXONOMY_TOP_N = 20;

type ByRank = Record<string, Record<string, number>>;

export function trimTaxonomyByRank(
  byRank: Record<string, Record<string, number> | undefined>,
  topN = TAXONOMY_TOP_N,
) {
  const distributions: ByRank = {};
  const taxaCounts: Record<string, number> = {};
  for (const [rank, maybeDist] of Object.entries(byRank ?? {})) {
    // The SQL path passes the JSON through unvalidated: a non-finite share would
    // leave the sort order undefined, and it is not a taxon share to count.
    const entries = Object.entries(maybeDist ?? {}).filter(([, v]) => Number.isFinite(v));
    taxaCounts[rank] = entries.length;
    distributions[rank] = entries.length <= topN
      ? Object.fromEntries(entries)
      : Object.fromEntries(
        entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, topN),
      );
  }
  return { distributions, taxaCounts };
}
