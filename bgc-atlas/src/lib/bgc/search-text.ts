/**
 * How /bgcs free-text search (`?search=`) reads what was typed. Shared by the
 * OpenSearch path (lib/opensearch/browse-query.ts) and the SQL fallback
 * (app/api/bgcs/route.ts), so the two answer the same question.
 *
 * It used to be a case-insensitive "contains" over every field. On the four
 * identifier fields that walks millions of distinct values each -- bgc_id 4.0 s,
 * filename 3.2 s, contig 1.8 s, assembly 0.45 s -- so every search took ~10 s and
 * more than half were abandoned. What readers type (two weeks of logs): product
 * types, genome accessions, BGC ids -- one pasted as a whole file path -- none of
 * which needs a match in the MIDDLE of an identifier. So:
 *
 *   - a UUID anywhere in the text is matched exactly against the BGC and assembly
 *     ids (a pasted `/path/<bgc_id>.gbk.gz` finds its BGC);
 *   - otherwise the identifiers match by prefix ("starts with", 1-2 ms), and the
 *     low-cardinality fields -- biomes, environment, product, sample labels, which
 *     carry genome accessions -- keep "contains".
 *
 * Lost: matching text in the middle of a filename or contig ("region008").
 */

const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export type BgcSearch =
  | { kind: 'uuid'; uuid: string }
  | { kind: 'text'; text: string };

export function parseBgcSearch(raw: string): BgcSearch | null {
  const text = raw.trim();
  if (!text) return null;
  const uuid = text.match(UUID_ANYWHERE)?.[0];
  return uuid ? { kind: 'uuid', uuid: uuid.toLowerCase() } : { kind: 'text', text };
}

/** Identifier fields: matched exactly (UUID) or by prefix, never by "contains". */
export const BGC_SEARCH_ID_FIELDS = ['bgc_id', 'filename', 'assembly_id', 'contig'] as const;

/** Few distinct values each, so "contains" stays cheap (all ten together < 0.3 s). */
export const BGC_SEARCH_CONTAINS_FIELDS = [
  'resolved_biome_level_1', 'resolved_biome_level_2', 'resolved_biome_level_3', 'resolved_biome_level_4',
  'environment_biome', 'environment_feature', 'environment_material',
  'product_type', 'product_category', 'sample_labels',
] as const;
