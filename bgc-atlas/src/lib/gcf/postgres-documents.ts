/**
 * Browse-shaped documents from Postgres for families gcf_browse does not hold: it
 * indexes only listed families, but BiG-SLiCE and property search reach unlisted ones.
 * Reads the same views as the rest of the site so pages agree about a family, and
 * emits the index document shape for mapGcfBrowseDocument.
 */
import { Prisma } from '@prisma/client';

import prisma from '@/lib/prisma';

/** Guard against a pathological result set. The entity export raises it, since a
 *  large download legitimately names thousands of unlisted families. */
export const MAX_FALLBACK_FAMILIES = 200;

type Document = Record<string, unknown>;

export async function fetchGcfDocumentsFromPostgres(
  gcfIds: string[], limit: number = MAX_FALLBACK_FAMILIES,
): Promise<Document[]> {
  const ids = gcfIds.slice(0, limit);
  if (ids.length === 0) return [];

  // Not joined to `gcf_summary`: it is an aggregating view and makes this take seconds.
  // No `bgcs` either: narrowing it from a subquery sorts the 16.5M-row corpus.
  const rows = await prisma.$queryRaw<Array<{
    id: string; name: string; pet_name: string | null; family_class: string | null;
    listed: boolean; n_bgc: number; cluster_method: string | null;
    product_category_distribution: unknown; biome_l1: unknown; biome_l2: unknown;
    biome_l3: unknown; biome_l4: unknown; biome_l5: unknown;
    domain_distribution: unknown; rank_distributions: unknown;
  }>>(Prisma.sql`
    SELECT
      g.id, g.name, g.pet_name, g.family_class, g.listed, g.n_bgc, g.cluster_method,
      d.product_category_distribution,
      d.biome_distribution_l1 AS biome_l1, d.biome_distribution_l2 AS biome_l2,
      d.biome_distribution_l3 AS biome_l3, d.biome_distribution_l4 AS biome_l4,
      d.biome_distribution_l5 AS biome_l5,
      t.domain_distribution, t.rank_distributions
    FROM gcfs g
    LEFT JOIN gcf_distributions_mv d ON d.gcf_id = g.id
    LEFT JOIN gcf_taxonomy_distribution_mv t ON t.gcf_id = g.id
    WHERE g.id = ANY(${ids}::uuid[])
  `);

  return rows.map((row) => ({
    gcf_id: row.id,
    gcf_name: row.name,
    pet_name: row.pet_name,
    family_class: row.family_class,
    listed: row.listed,
    cluster_method: row.cluster_method,
    member_bgc_count: Number(row.n_bgc),
    product_category_distribution: row.product_category_distribution ?? {},
    biome_distribution_l1: row.biome_l1 ?? {},
    biome_distribution_l2: row.biome_l2 ?? {},
    biome_distribution_l3: row.biome_l3 ?? {},
    biome_distribution_l4: row.biome_l4 ?? {},
    biome_distribution_l5: row.biome_l5 ?? {},
    taxonomy_distribution: row.domain_distribution ?? {},
    taxonomy_distributions: row.rank_distributions ?? {},
    // product_type_distribution, assembly_count and length stats exist only in the
    // index; an absent field renders as "—".
  } satisfies Document));
}
