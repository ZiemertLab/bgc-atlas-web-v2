/**
 * A GCF's GOLD ecosystem distribution, aggregated from bgc_browse.
 *
 * Replaces a SQL join that looked up every member BGC in `bgcs` to find its
 * assembly — one cold read per member, ~155 s for a 92k-member family.
 * bgc_browse already carries each BGC's primary `gcf_id` and its assembly's
 * `gold_ecosystem_path`, so the same counts are one terms aggregation (~170 ms).
 *
 * Equivalent to the SQL only while no assembly carries more than one GOLD path
 * (the SQL counts a BGC once per distinct path; the index holds one). That was
 * true of every assembly when this was written — 0 exceptions — and the two
 * were diffed identical on the 92k-member family, path by path.
 */

export interface GoldPathCount {
  gold_ecosystem_path: string;
  bgc_count: number;
}

/**
 * Every path a family's members carry. The corpus holds 877 distinct GOLD paths,
 * so 1,000 buckets is all of them. It was the top 50, and the route takes each
 * level's shares over the rows it gets: on GCF c83196fc that dropped 18 of its 27
 * level-2 ecosystems and made the shares of the rest a share of 50 paths.
 */
export const GOLD_PATH_BUCKETS = 1000;

export function buildGcfGoldDistributionRequest(gcfId: string, limit = GOLD_PATH_BUCKETS): Record<string, unknown> {
  return {
    size: 0,
    query: {
      bool: {
        filter: [{ term: { gcf_id: gcfId } }, { exists: { field: 'gold_ecosystem_path' } }],
        must_not: [{ term: { gold_ecosystem_path: '' } }],
      },
    },
    aggs: { paths: { terms: { field: 'gold_ecosystem_path', size: limit } } },
  };
}

export function parseGcfGoldDistributionResponse(response: unknown): GoldPathCount[] {
  const buckets = (response as {
    aggregations?: { paths?: { buckets?: Array<{ key: string; doc_count: number }> } };
  }).aggregations?.paths?.buckets;
  if (!Array.isArray(buckets)) throw new Error('OpenSearch response has no paths aggregation');
  return buckets.map((b) => ({ gold_ecosystem_path: b.key, bgc_count: b.doc_count }));
}
