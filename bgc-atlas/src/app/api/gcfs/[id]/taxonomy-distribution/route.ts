import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getOrSetCache } from '@/lib/cache';
import { serverError } from '@/lib/api/errors';

const isValidUuid = (id: string) => {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
};

/** GET /api/gcfs/[id]/taxonomy-distribution */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    if (!isValidUuid(id)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid GCF ID format',
          message: 'GCF ID must be a valid UUID',
        },
        { status: 400 }
      );
    }

    // v2: numeric coercion fixed (v1 leaked Decimal/string through the cache)
    const cacheKey = `gcf:taxonomy-distribution:v2:${id}`;

    const payload = await getOrSetCache(
      cacheKey,
      async () => {
        type TaxonomyRow = {
          domain: string | null;
          phylum: string | null;
          class: string | null;
          order_name: string | null;
          family: string | null;
          genus: string | null;
          species: string | null;
          gtdb_lineage: string;
          is_partial: boolean;
          rank_depth: number;
          bgc_count: string | number;
          percentage: string | number;
        };

        // Members collapse to far fewer distinct taxonomy_ids (535k -> ~17k), so
        // scan them once into an ON COMMIT DROP temp table that both queries read.
        // work_mem is pinned so the GROUP BY stays off CephFS temp; SET LOCAL and
        // the temp table both revert at commit. id is UUID-validated above.
        const { taxonomyData, summaryResult } = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL work_mem = '256MB'`);
        await tx.$executeRawUnsafe(
          // LEFT: bgc_taxonomy has no row for an unclassified BGC, and that NULL
          // bucket feeds bgcs_without_taxonomy.
          `CREATE TEMP TABLE gcf_tax_counts ON COMMIT DROP AS
             SELECT bt.taxonomy_id, COUNT(*)::int AS bgc_count
             FROM bgc_gcf bg
             LEFT JOIN bgc_taxonomy bt ON bt.bgc_id = bg.bgc_id
             -- primary membership only, so the distribution sums to the member count
             WHERE bg.gcf_id = '${id}'::uuid AND bg.is_primary
             GROUP BY bt.taxonomy_id`
        );

        const taxonomyData = await tx.$queryRaw<TaxonomyRow[]>`
          WITH taxonomy_by_rank AS (
            -- Two taxonomy_ids can share a lineage.
            SELECT
              t.domain,
              t.phylum,
              t.class,
              t.order_name,
              t.family,
              t.genus,
              t.species,
              t.gtdb_lineage,
              t.is_partial,
              t.rank_depth,
              SUM(tc.bgc_count)::int as bgc_count
            FROM gcf_tax_counts tc
            JOIN taxonomies t ON t.id = tc.taxonomy_id
            GROUP BY t.domain, t.phylum, t.class, t.order_name,
                     t.family, t.genus, t.species, t.gtdb_lineage,
                     t.is_partial, t.rank_depth
            ORDER BY bgc_count DESC
            LIMIT 20
          )
          SELECT
            *,
            ROUND((bgc_count::float / SUM(bgc_count) OVER () * 100)::numeric, 2) as percentage
          FROM taxonomy_by_rank
        `;

        type SummaryRow = {
          total_bgcs: string | number;
          bgcs_with_taxonomy: string | number;
          bgcs_without_taxonomy: string | number;
          unique_domains: string | number;
          unique_phyla: string | number;
          unique_classes: string | number;
          unique_orders: string | number;
          unique_families: string | number;
          unique_genera: string | number;
          unique_species: string | number;
        };

        const [summaryResult] = await tx.$queryRaw<SummaryRow[]>`
          SELECT
            COALESCE(SUM(tc.bgc_count), 0)::int as total_bgcs,
            COALESCE(SUM(tc.bgc_count) FILTER (WHERE tc.taxonomy_id IS NOT NULL), 0)::int as bgcs_with_taxonomy,
            COALESCE(SUM(tc.bgc_count) FILTER (WHERE tc.taxonomy_id IS NULL), 0)::int as bgcs_without_taxonomy,
            COUNT(DISTINCT t.domain) FILTER (WHERE t.domain IS NOT NULL)::int as unique_domains,
            COUNT(DISTINCT t.phylum) FILTER (WHERE t.phylum IS NOT NULL)::int as unique_phyla,
            COUNT(DISTINCT t.class) FILTER (WHERE t.class IS NOT NULL)::int as unique_classes,
            COUNT(DISTINCT t.order_name) FILTER (WHERE t.order_name IS NOT NULL)::int as unique_orders,
            COUNT(DISTINCT t.family) FILTER (WHERE t.family IS NOT NULL)::int as unique_families,
            COUNT(DISTINCT t.genus) FILTER (WHERE t.genus IS NOT NULL)::int as unique_genera,
            COUNT(DISTINCT t.species) FILTER (WHERE t.species IS NOT NULL)::int as unique_species
          FROM gcf_tax_counts tc
          LEFT JOIN taxonomies t ON t.id = tc.taxonomy_id
        `;

          return { taxonomyData, summaryResult };
        }, { timeout: 120000, maxWait: 20000 });

        // Prisma may return numerics as string, number or Decimal.
        const distribution = taxonomyData.map((row) => ({
          domain: row.domain,
          phylum: row.phylum,
          class: row.class,
          order: row.order_name,
          family: row.family,
          genus: row.genus,
          species: row.species,
          gtdbLineage: row.gtdb_lineage,
          bgcCount: Number(row.bgc_count),
          percentage: Number(row.percentage),
          isPartial: row.is_partial,
          rankDepth: row.rank_depth,
        }));

        const totalBgcs =
          typeof summaryResult.total_bgcs === 'string'
            ? parseInt(summaryResult.total_bgcs)
            : summaryResult.total_bgcs;
        const bgcsWithTaxonomy =
          typeof summaryResult.bgcs_with_taxonomy === 'string'
            ? parseInt(summaryResult.bgcs_with_taxonomy)
            : summaryResult.bgcs_with_taxonomy;

        const summary = {
          totalBgcsWithTaxonomy: bgcsWithTaxonomy,
          totalBgcsWithoutTaxonomy:
            typeof summaryResult.bgcs_without_taxonomy === 'string'
              ? parseInt(summaryResult.bgcs_without_taxonomy)
              : summaryResult.bgcs_without_taxonomy,
          coveragePercentage:
            totalBgcs > 0 ? parseFloat(((bgcsWithTaxonomy / totalBgcs) * 100).toFixed(2)) : 0,
          uniqueDomains:
            typeof summaryResult.unique_domains === 'string'
              ? parseInt(summaryResult.unique_domains)
              : summaryResult.unique_domains,
          uniquePhyla:
            typeof summaryResult.unique_phyla === 'string'
              ? parseInt(summaryResult.unique_phyla)
              : summaryResult.unique_phyla,
          uniqueClasses:
            typeof summaryResult.unique_classes === 'string'
              ? parseInt(summaryResult.unique_classes)
              : summaryResult.unique_classes,
          uniqueOrders:
            typeof summaryResult.unique_orders === 'string'
              ? parseInt(summaryResult.unique_orders)
              : summaryResult.unique_orders,
          uniqueFamilies:
            typeof summaryResult.unique_families === 'string'
              ? parseInt(summaryResult.unique_families)
              : summaryResult.unique_families,
          uniqueGenera:
            typeof summaryResult.unique_genera === 'string'
              ? parseInt(summaryResult.unique_genera)
              : summaryResult.unique_genera,
          uniqueSpecies:
            typeof summaryResult.unique_species === 'string'
              ? parseInt(summaryResult.unique_species)
              : summaryResult.unique_species,
        };

        return {
          distribution,
          summary,
        };
      },
      3600
    );

    return NextResponse.json(
      {
        success: true,
        data: payload,
        message: 'Taxonomy distribution retrieved successfully',
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600',
        },
      }
    );
  } catch (error) {
    return serverError(error, 'Error fetching taxonomy distribution');
  }
}
