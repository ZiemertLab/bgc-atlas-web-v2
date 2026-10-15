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

/** Top-N paths by member BGC count, matching the SQL's ORDER BY ... LIMIT. */
export function buildGcfGoldDistributionRequest(gcfId: string, limit = 50): Record<string, unknown> {
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
