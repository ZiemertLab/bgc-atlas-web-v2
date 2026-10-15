import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { buildListCacheKeys, getOrSetCache } from '@/lib/cache';
import { gcfFilterFields } from '@/lib/filters/field-definitions';
import { filterRefusalResponse } from '@/lib/api/filter-refusal';
import { deepPageRefusal } from '@/lib/api/deep-page-refusal';
import { isBrowseSearchEnabled, searchBrowseIndex } from '@/lib/opensearch/browse-client';
import { supportsBrowseSearch } from '@/lib/opensearch/browse-query';
import { mapGcfBrowseDocument } from '@/lib/opensearch/gcf-browse-mapper';
import { withKnownClusterRollup } from '@/lib/opensearch/known-cluster-decorations';
import { parseAdvancedFilterParam, type FilterCondition } from '@/lib/filters/types';
import {
  CATEGORY_SHARE_SORT_FIELD,
  categoryForShareSort,
  parseCategoryFilter,
} from '@/lib/gcf/category-share';
import { isFamilyClass, parseFamilyClass } from '@/lib/gcf/family-class';
import {
  buildAdvancedWhere,
  buildNumberCondition,
  buildTextCondition,
} from '@/lib/filters/prisma-builders';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const toLike = (value: string) => `%${value.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;

const isValidUuid = (id: string) => {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
};

const parseNumber = (value: string | null, options: { fallback?: number; clampMin?: number; clampMax?: number } = {}) => {
  if (!value) return undefined;
  const num = Number(value);
  if (!Number.isFinite(num)) return options.fallback;
  let result = num;
  if (options.clampMin !== undefined && result < options.clampMin) result = options.clampMin;
  if (options.clampMax !== undefined && result > options.clampMax) result = options.clampMax;
  return result;
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const params = url.searchParams;

    // ?clusterMethod= is refused, not ignored: the column holds one value for
    // every family, and ignoring it would widen `zzz` from 0 rows to all.
    if (params.has('clusterMethod')) {
      const message = 'The clusterMethod filter has been removed: every family in the'
        + ' corpus shares one clustering method (bigslice-2.0-birch), so the filter could'
        + ' only ever match all families or none. The method is still reported on each'
        + ' family. Drop the parameter to get the same families you were asking for.';
      return NextResponse.json(
        { success: false, error: message, message, rejected: ['clusterMethod'] },
        { status: 400 },
      );
    }

    const limit = parseNumber(params.get('limit'), { fallback: DEFAULT_LIMIT, clampMin: 1, clampMax: MAX_LIMIT }) ?? DEFAULT_LIMIT;
    const offset = parseNumber(params.get('offset'), { fallback: 0, clampMin: 0 }) ?? 0;
    const ecosystemLevel = parseNumber(params.get('ecosystemLevel'), { fallback: 1, clampMin: 1, clampMax: 5 }) ?? 1;

    if (isBrowseSearchEnabled('gcfs') && supportsBrowseSearch('gcfs', params)) {
      try {
        const result = await searchBrowseIndex('gcfs', params);
        const rows = result.documents.map(mapGcfBrowseDocument);
        return NextResponse.json(
          {
            success: true,
            data: { data: await withKnownClusterRollup(rows), total: result.total, limit, offset },
            message: `Found ${result.total} GCFs`,
          },
          { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } },
        );
      } catch (error) {
        // A refused filter is a 400, not an outage; falling through would re-refuse
        // after a full-corpus scan.
        if (filterRefusalResponse(error)) throw error;
        console.error('OpenSearch GCF browse query failed; falling back to PostgreSQL', error);
      }
    }

    // ?study= has no SQL equivalent, so continuing would answer for every GCF.
    // Outside the catch: the index is also switched off during re-clustering cutovers.
    if (params.has('study')) {
      return NextResponse.json(
        {
          success: false,
          error: 'Study-filtered GCF search unavailable',
          message: 'The families index is unavailable; please retry.',
        },
        { status: 503 },
      );
    }

    // SQL paging cost follows the depth (offset 12,000 with a biome filter ~21s),
    // so refuse deep pages here.
    const tooDeepForSql = deepPageRefusal(offset, limit);
    if (tooDeepForSql) return tooDeepForSql;

    const filters: Prisma.Sql[] = [
      Prisma.sql`g.member_bgc_count > 0`,
      // Unlisted families (fragmented singletons, secondary-hit-only seeds) keep
      // their memberships but are not listed.
      Prisma.sql`gsrc.listed`,
    ];

    // Majority categories only, so "NRPS" doesn't find a huge family by a few
    // members. Not cluster_method: one value for every row. Self-contained EXISTS
    // so the COUNT can use it too.
    const search = params.get('search');
    if (search && search.trim()) {
      const like = toLike(search.trim());
      filters.push(Prisma.sql`(
        g.gcf_id::text ILIKE ${like}
        OR g.gcf_name ILIKE ${like}
        OR gsrc.pet_name ILIKE ${like}
        OR g.description ILIKE ${like}
        OR EXISTS (
          SELECT 1 FROM gcf_distributions_mv gdm, unnest(gdm.majority_categories) mc
          WHERE gdm.gcf_id = g.gcf_id AND mc ILIKE ${like}
        )
      )`);
    }

    const idFilter = params.get('id');
    if (idFilter && idFilter.trim()) {
      const val = idFilter.trim();
      if (isValidUuid(val)) {
        filters.push(Prisma.sql`g.gcf_id = ${val}::uuid`);
      } else {
        const like = toLike(val);
        filters.push(Prisma.sql`g.gcf_id::text ILIKE ${like}`);
      }
    }

    const nameFilter = params.get('name');
    if (nameFilter && nameFilter.trim()) {
      const like = toLike(nameFilter.trim());
      filters.push(Prisma.sql`g.gcf_name ILIKE ${like}`);
    }

    const minBgcs = parseNumber(params.get('minBgcs'), { clampMin: 0 });
    if (minBgcs !== undefined) {
      filters.push(Prisma.sql`g.member_bgc_count >= ${minBgcs}`);
    }

    const maxBgcs = parseNumber(params.get('maxBgcs'), { clampMin: 0 });
    if (maxBgcs !== undefined) {
      filters.push(Prisma.sql`g.member_bgc_count <= ${maxBgcs}`);
    }

    // With a threshold, a share of members (same column gcf_browse is patched
    // from); without one, the "any member" text match existing links rely on.
    const category = parseCategoryFilter(params);
    if (category?.kind === 'contains') {
      const like = toLike(category.text);
      filters.push(Prisma.sql`EXISTS (SELECT 1 FROM unnest(g.product_categories) pc WHERE pc ILIKE ${like})`);
    } else if (category?.kind === 'share' && category.minShare > 0) {
      filters.push(Prisma.sql`EXISTS (
        SELECT 1 FROM gcf_distributions_mv gdm
        WHERE gdm.gcf_id = g.gcf_id
          AND (gdm.category_member_share ->> ${category.category})::numeric >= ${category.minShare}
      )`);
    } else if (category?.kind === 'share') {
      // Membership, not `share > 0`: shares are stored to 2 dp and tiny minorities round to 0.00.
      filters.push(Prisma.sql`${category.category} = ANY(g.product_categories)`);
    }

    const biome = params.get('biome');
    if (biome && biome.trim()) {
      const like = toLike(biome.trim());
      filters.push(Prisma.sql`EXISTS (
        SELECT 1
        FROM gcf_environmental_distribution_mv env
        WHERE env.gcf_id = g.gcf_id
          AND (
            env.biome_level_1 ILIKE ${like}
            OR env.biome_level_2 ILIKE ${like}
            OR env.biome_level_3 ILIKE ${like}
          )
      )`);
    }
    // Mirrors the index's `mibig_anchored` filter, so the chip still filters on the SQL fallback.
    if (['1', 'true'].includes((params.get('mibigAnchored') ?? '').toLowerCase())) {
      filters.push(Prisma.sql`EXISTS (
        SELECT 1 FROM gcf_mibig_anchor a WHERE a.gcf_id = g.gcf_id
      )`);
    }
    // Mirrors the index's `term: {family_class}`; invalid values throw -> 400.
    const familyClass = parseFamilyClass(params);
    if (familyClass) {
      filters.push(Prisma.sql`g.family_class = ${familyClass}`);
    }

    const advancedGroup = parseAdvancedFilterParam(params.get('advancedFilters'));
    // Refuses rather than widens, like the other browse routes.
    const advancedWhere = buildAdvancedWhere(
      advancedGroup,
      buildGcfAdvancedCondition,
      gcfFilterFields,
    );
    if (advancedWhere) {
      filters.push(advancedWhere);
    }

    const where = filters.length > 0
      ? Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}`
      : Prisma.sql``;

    const sortField = params.get('sortField') ?? 'name';
    const sortOrder = params.get('sortOrder') === 'desc' ? 'DESC' : 'ASC';

    let orderBy: Prisma.Sql;
    switch (sortField) {
      case 'name':
        orderBy = Prisma.sql`ORDER BY g.gcf_name ${Prisma.raw(sortOrder)}`;
        break;
      case 'member_count':
      case 'memberCount':
      case 'bgcCount':
        orderBy = Prisma.sql`ORDER BY g.member_bgc_count ${Prisma.raw(sortOrder)}`;
        break;
      case 'assembly_count':
      case 'assemblyCount':
        orderBy = Prisma.sql`ORDER BY g.assembly_count ${Prisma.raw(sortOrder)}`;
        break;
      case 'product_diversity':
      case 'productDiversity':
        orderBy = Prisma.sql`ORDER BY g.unique_product_categories ${Prisma.raw(sortOrder)}`;
        break;
      case 'taxa_count':
      case 'taxaCount':
        orderBy = Prisma.sql`ORDER BY g.unique_taxa_count ${Prisma.raw(sortOrder)}`;
        break;
      case 'avg_score':
      case 'avgScore':
      case 'avg_distance':
      case 'avgDistance':
        orderBy = Prisma.sql`ORDER BY g.avg_distance ${Prisma.raw(sortOrder)}`;
        break;
      case 'familyClass':
      case 'family_class':
        orderBy = Prisma.sql`ORDER BY g.family_class ${Prisma.raw(sortOrder)}`;
        break;
      case 'petName':
      case 'pet_name':
        // NULLS LAST keeps unnamed families out of the head of an ascending sort.
        orderBy = Prisma.sql`ORDER BY gsrc.pet_name ${Prisma.raw(sortOrder)} NULLS LAST`;
        break;
      case 'biomeDistribution':
      case 'dominantBiome':
        orderBy = Prisma.sql`ORDER BY gd.max_pct_l${Prisma.raw(String(ecosystemLevel))} ${Prisma.raw(sortOrder)} NULLS LAST`;
        break;
      case CATEGORY_SHARE_SORT_FIELD: {
        // No single category to order by -> the default order, as browse-query.ts does.
        const shareCategory = categoryForShareSort(params);
        orderBy = shareCategory
          ? Prisma.sql`ORDER BY (gd.category_member_share ->> ${shareCategory})::numeric ${Prisma.raw(sortOrder)} NULLS LAST`
          : Prisma.sql`ORDER BY g.gcf_name ${Prisma.raw(sortOrder)}`;
        break;
      }
      case 'length':
      case 'bgcLength':
        // The displayed value: median over complete members, else the longest
        // member. Matches idx_gcf_length_stats_mv_est.
        orderBy = Prisma.sql`ORDER BY COALESCE(gl.median_complete_len, gl.max_len) ${Prisma.raw(sortOrder)} NULLS LAST`;
        break;
      default:
        orderBy = Prisma.sql`ORDER BY g.gcf_name ${Prisma.raw(sortOrder)}`;
        break;
    }

    // Deterministic paging: no key above is unique. ASC matches the OpenSearch
    // path, so both backends return the same page for one URL.
    orderBy = Prisma.sql`${orderBy}, g.gcf_id ASC`;

    // Bump the version on a change of meaning as well as shape.
    const { dataKey, countKey } = buildListCacheKeys('gcfs:list:v3', params, [
      'limit', 'offset', 'sortField', 'sortOrder', 'sortFields', 'sortOrders', 'ecosystemLevel',
    ]);

    const fetchTotal = async (): Promise<number> => {
    // The WHERE can reference gsrc.pet_name; the 1:1 LEFT JOIN can't change the
    // count and Postgres removes it when unused.
      const totalResult = await prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM gcf_summary_mv g
        LEFT JOIN gcfs gsrc ON gsrc.id = g.gcf_id
        ${where}
      `);
      return Number(totalResult?.[0]?.count ?? 0);
    };

    const fetchData = async () => {
      type RawRow = {
        gcf_id: string;
        gcf_name: string | null;
        cluster_method: string | null;
        family_class: string | null;
        pet_name: string | null;
        mibig_accessions: string[] | null;
        mibig_compounds: string[] | null;
        representative_bgc_id: string | null;
        description: string | null;
        member_bgc_count: number | string;
        assembly_count: number | string;
        complete_bgc_count: number | string;
        partial_bgc_count: number | string;
        // lower = better
        avg_distance: number | string | { toNumber?: () => number } | null;
        min_distance: number | string | { toNumber?: () => number } | null;
        max_distance: number | string | { toNumber?: () => number } | null;
        median_distance: number | string | { toNumber?: () => number } | null;
        unique_product_categories: number | string;
        product_categories: string[] | null;
        unique_taxa_count: number | string;
        seed_assignments: number | string;
        derived_assignments: number | string;
        novel_assignments: number | string;
        biome_distribution_l1: Record<string, number> | null;
        biome_distribution_l2: Record<string, number> | null;
        biome_distribution_l3: Record<string, number> | null;
        biome_distribution_l4: Record<string, number> | null;
        biome_distribution_l5: Record<string, number> | null;
        product_category_distribution: Record<string, number> | null;
        product_type_distribution: Record<string, number> | null;
        taxonomy_distribution: Record<string, number> | null;
        taxonomy_distributions: Record<string, Record<string, number>> | null;
        median_complete_len: number | string | null;
        min_len: number | string | null;
        max_len: number | string | null;
        complete_member_count: number | string | null;
        length_member_count: number | string | null;
      };

      const rows = await prisma.$queryRaw<RawRow[]>(Prisma.sql`
        SELECT
          g.gcf_id,
          g.gcf_name,
          g.cluster_method,
          gsrc.family_class,
          gsrc.pet_name,
          g.representative_bgc_id,
          g.description,
          g.member_bgc_count,
          g.assembly_count,
          g.complete_bgc_count,
          g.partial_bgc_count,
          g.avg_distance,
          g.min_distance,
          g.max_distance,
          g.median_distance,
          g.unique_product_categories,
          g.product_categories,
          g.unique_taxa_count,
          g.seed_assignments,
          g.derived_assignments,
          g.novel_assignments,
          COALESCE(gd.biome_distribution_l1, '{}'::jsonb) AS biome_distribution_l1,
          COALESCE(gd.biome_distribution_l2, '{}'::jsonb) AS biome_distribution_l2,
          COALESCE(gd.biome_distribution_l3, '{}'::jsonb) AS biome_distribution_l3,
          COALESCE(gd.biome_distribution_l4, '{}'::jsonb) AS biome_distribution_l4,
          COALESCE(gd.biome_distribution_l5, '{}'::jsonb) AS biome_distribution_l5,
          COALESCE(gd.product_category_distribution, '{}'::jsonb) AS product_category_distribution,
          COALESCE(ptd.dist, '{}'::jsonb) AS product_type_distribution,
          COALESCE(tax_dist.domain_distribution, '{}'::jsonb) AS taxonomy_distribution,
          COALESCE(tax_dist.rank_distributions, '{}'::jsonb) AS taxonomy_distributions,
          gl.median_complete_len,
          gl.min_len,
          gl.max_len,
          gl.complete_count AS complete_member_count,
          gl.member_count AS length_member_count,
          -- Also selected here so the column isn't empty on the SQL fallback.
          COALESCE(mib.accessions, ARRAY[]::text[]) AS mibig_accessions,
          COALESCE(mib.compounds, ARRAY[]::text[]) AS mibig_compounds
        FROM gcf_summary_mv g
        -- INNER: listed is a filter, and a missing gcfs row means a broken MV.
        JOIN gcfs gsrc
          ON gsrc.id = g.gcf_id
        LEFT JOIN gcf_distributions_mv gd
          ON gd.gcf_id = g.gcf_id
        LEFT JOIN LATERAL (
          SELECT jsonb_object_agg(pt, ROUND(100.0 * cnt / total, 1)) AS dist
          FROM (
            SELECT m.product AS pt,
                   SUM(m.bgc_count) AS cnt,
                   SUM(SUM(m.bgc_count)) OVER () AS total
            FROM gcf_product_type_matrix_mv m
            WHERE m.gcf_id = g.gcf_id
            GROUP BY m.product
          ) per_type
          WHERE total > 0
        ) ptd ON true
        LEFT JOIN gcf_taxonomy_distribution_mv tax_dist
          ON tax_dist.gcf_id = g.gcf_id
        -- LEFT: a family with no members has no row.
        LEFT JOIN gcf_length_stats_mv gl
          ON gl.gcf_id = g.gcf_id
        LEFT JOIN LATERAL (
          -- DISTINCT: references repeat compound names. Almost always misses, so
          -- this is one keyed probe.
          SELECT array_agg(DISTINCT a.mibig_accession) AS accessions,
                 (SELECT array_agg(DISTINCT c)
                    FROM gcf_mibig_anchor a2, unnest(a2.compounds) AS c
                   WHERE a2.gcf_id = g.gcf_id) AS compounds
          FROM gcf_mibig_anchor a WHERE a.gcf_id = g.gcf_id
          HAVING count(*) > 0
        ) mib ON true
        ${where}
        ${orderBy}
        LIMIT ${limit} OFFSET ${offset}
      `);

      const data = rows.map((r: RawRow) => {
        const toNum = (val: number | string | { toNumber?: () => number } | null | undefined): number | null => {
          if (val === null || val === undefined) return null;
          if (typeof val === 'number') return val;
          if (typeof val === 'object' && 'toNumber' in val && typeof val.toNumber === 'function') {
            return val.toNumber();
          }
          const num = Number(val);
          return Number.isFinite(num) ? num : null;
        };

        const asDist = (val: Record<string, number> | null): Record<string, number> =>
          typeof val === 'object' && val !== null ? val : {};

        return {
          id: r.gcf_id,
          name: r.gcf_name ?? `GCF_${r.gcf_id.slice(0, 8)}`,
          clusterMethod: r.cluster_method ?? null,
          familyClass: r.family_class ?? null,
          petName: r.pet_name ?? null,
          // Same shape as the OpenSearch mapper.
          mibigAnchored: (r.mibig_accessions?.length ?? 0) > 0,
          mibigAccessions: r.mibig_accessions ?? [],
          mibigCompounds: r.mibig_compounds ?? [],
          representativeBgcId: r.representative_bgc_id ?? null,
          description: r.description ?? null,
          memberBgcCount: toNum(r.member_bgc_count) ?? 0,
          assemblyCount: toNum(r.assembly_count) ?? 0,
          completeBgcCount: toNum(r.complete_bgc_count) ?? 0,
          partialBgcCount: toNum(r.partial_bgc_count) ?? 0,
          // lower = better
          avgDistance: toNum(r.avg_distance),
          minDistance: toNum(r.min_distance),
          maxDistance: toNum(r.max_distance),
          medianDistance: toNum(r.median_distance),
          uniqueProductCategories: toNum(r.unique_product_categories) ?? 0,
          productCategories: Array.isArray(r.product_categories) ? r.product_categories : [],
          uniqueTaxaCount: toNum(r.unique_taxa_count) ?? 0,
          seedAssignments: toNum(r.seed_assignments) ?? 0,
          derivedAssignments: toNum(r.derived_assignments) ?? 0,
          novelAssignments: toNum(r.novel_assignments) ?? 0,
          biomeDistributionByLevel: {
            1: asDist(r.biome_distribution_l1),
            2: asDist(r.biome_distribution_l2),
            3: asDist(r.biome_distribution_l3),
            4: asDist(r.biome_distribution_l4),
            5: asDist(r.biome_distribution_l5),
          },
          productCategoryDistribution: typeof r.product_category_distribution === 'object' && r.product_category_distribution !== null
            ? r.product_category_distribution as Record<string, number>
            : {},
          productTypeDistribution: asDist(r.product_type_distribution),
          taxonomyDistribution: typeof r.taxonomy_distribution === 'object' && r.taxonomy_distribution !== null
            ? r.taxonomy_distribution as Record<string, number>
            : {},
          taxonomyDistributionByRank: typeof r.taxonomy_distributions === 'object' && r.taxonomy_distributions !== null
            ? r.taxonomy_distributions as Record<string, Record<string, number>>
            : {},
          // See lib/utils/bgc-length.ts.
          lengthStats: r.length_member_count === null || r.length_member_count === undefined
            ? null
            : {
                medianCompleteLen: toNum(r.median_complete_len),
                minLen: toNum(r.min_len),
                maxLen: toNum(r.max_len),
                completeCount: toNum(r.complete_member_count) ?? 0,
                memberCount: toNum(r.length_member_count) ?? 0,
              },
        };
      });

      return data;
    };

    const [total, data] = await Promise.all([
      getOrSetCache(countKey, fetchTotal, 600),
      getOrSetCache(dataKey, fetchData, 60),
    ]);

    return NextResponse.json(
      {
        success: true,
        // Enriched outside getOrSetCache so the cached payload shape is unchanged.
        data: { data: await withKnownClusterRollup(data), total, limit, offset },
        message: `Found ${total} GCFs`,
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      }
    );
  } catch (error) {
    const refusal = filterRefusalResponse(error);
    if (refusal) return refusal;
    console.error('GCFs API Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch GCFs',
        // The exception stays in the log; see /api/bgcs.
        message: 'Unable to retrieve families from the database.',
        data: {
          data: [],
          total: 0,
          limit: DEFAULT_LIMIT,
          offset: 0,
        },
      },
      { status: 500 }
    );
  }
}

const buildGcfAdvancedCondition = (condition: FilterCondition): Prisma.Sql | null => {
  switch (condition.field) {
    case 'id':
      return buildTextCondition(Prisma.sql`g.gcf_id::text`, condition, toLike);
    case 'name':
      return buildTextCondition(Prisma.sql`g.gcf_name`, condition, toLike);
    case 'productType':
      return buildProductCategoryCondition(condition);
    case 'productClass':
      return buildProductTypeCondition(condition);
    case 'biome':
      return buildBiomeCondition(condition);
    case 'completeBgcCount':
      return buildNumberCondition(Prisma.sql`g.complete_bgc_count`, condition);
    case 'taxaCount':
      return buildNumberCondition(Prisma.sql`g.unique_taxa_count`, condition);
    case 'productCategoryCount':
      return buildNumberCondition(Prisma.sql`g.unique_product_categories`, condition);
    // Each compiles to a self-contained EXISTS (one index lookup) so it composes
    // into fetchTotal's join-free COUNT.
    case 'studyCount':
      return buildScalarCondition(
        Prisma.sql`gcf_study_count`, Prisma.sql`study_count`, condition);
    case 'ecosystemSpecificity':
      return buildScalarCondition(
        Prisma.sql`gcf_distributions_mv`, Prisma.sql`max_pct_l1`, condition);
    case 'domEcosystemPct':
      return buildScalarCondition(
        Prisma.sql`gcf_distributions_mv`, Prisma.sql`max_pct_l3`, condition);
    case 'domPhylumPct':
      return buildScalarCondition(
        Prisma.sql`gcf_distributions_mv`, Prisma.sql`dom_phylum_pct`, condition);
    case 'domEcosystem':
      return buildScalarTextCondition(
        Prisma.sql`gcf_distributions_mv`, Prisma.sql`dom_ecosystem_l3`, condition);
    case 'domPhylum':
      return buildScalarTextCondition(
        Prisma.sql`gcf_distributions_mv`, Prisma.sql`dom_phylum`, condition);
    case 'mibigAnchored':
      return buildMibigAnchoredCondition(condition);
    case 'familyClass':
      return buildFamilyClassCondition(condition);
    case 'taxonomy':
      return buildTaxonomyCondition(condition);
    case 'memberBgcCount':
      return buildNumberCondition(Prisma.sql`g.member_bgc_count`, condition);
    case 'assemblyCount':
      return buildNumberCondition(Prisma.sql`g.assembly_count`, condition);
    case 'avgScore':
    case 'avgDistance':
      return buildNumberCondition(Prisma.sql`g.avg_distance`, condition);
    default:
      return null;
  }
};

/**
 * On the multi-valued fields (category, product, biome, taxonomy) a negative
 * means "no value matches", as the index's must_not + `exists` guard does:
 * SQL form `present AND NOT EXISTS(positive)`, `present` mirroring
 * build_browse_corpus.py.
 */
const POSITIVE_OF: Partial<Record<FilterCondition['operator'], FilterCondition['operator']>> = {
  not_contains: 'contains',
  not_equals: 'equals',
};

const noneOrAny = (
  condition: FilterCondition,
  present: Prisma.Sql,
  anyMatches: (positive: FilterCondition) => Prisma.Sql | null,
): Prisma.Sql | null => {
  const positive = POSITIVE_OF[condition.operator];
  if (!positive) return anyMatches(condition);
  const matches = anyMatches({ ...condition, operator: positive });
  return matches ? Prisma.sql`(${present} AND NOT ${matches})` : null;
};

const CATEGORY_PRESENT = Prisma.sql`EXISTS (
  SELECT 1 FROM unnest(g.product_categories) AS pc WHERE pc IS NOT NULL
)`;

const buildProductCategoryCondition = (condition: FilterCondition): Prisma.Sql | null =>
  noneOrAny(condition, CATEGORY_PRESENT, (c) => {
    const comparison = buildTextCondition(Prisma.sql`pc`, c, toLike);
    if (!comparison) return null;
    return Prisma.sql`
      EXISTS (
        SELECT 1
        FROM unnest(g.product_categories) AS pc
        WHERE ${comparison}
      )
    `;
  });

// Any primary member with a matching granular product (not on gcf_summary_mv).
const primaryMemberProduct = (test: Prisma.Sql) => Prisma.sql`
  EXISTS (
    SELECT 1
    FROM bgc_gcf bg
    JOIN bgcs b ON b.id = bg.bgc_id, unnest(b.product) AS pt
    WHERE bg.gcf_id = g.gcf_id
      AND bg.is_primary
      AND ${test}
  )
`;

const PRODUCT_PRESENT = primaryMemberProduct(Prisma.sql`pt IS NOT NULL AND pt <> ''`);

const buildProductTypeCondition = (condition: FilterCondition): Prisma.Sql | null =>
  noneOrAny(condition, PRODUCT_PRESENT, (c) => {
    const comparison = buildTextCondition(Prisma.sql`pt`, c, toLike);
    return comparison ? primaryMemberProduct(comparison) : null;
  });

/**
 * A numeric condition on a table keyed 1:1 on gcf_id. A missing row or NULL
 * fails both the positive and negative form, as in the index.
 */
const buildScalarCondition = (
  table: Prisma.Sql, column: Prisma.Sql, condition: FilterCondition,
): Prisma.Sql | null => {
  const comparison = buildNumberCondition(column, condition);
  if (!comparison) return null;
  return Prisma.sql`EXISTS (
    SELECT 1 FROM ${table} sc WHERE sc.gcf_id = g.gcf_id AND ${comparison}
  )`;
};

const buildScalarTextCondition = (
  table: Prisma.Sql, column: Prisma.Sql, condition: FilterCondition,
): Prisma.Sql | null => {
  const comparison = buildTextCondition(column, condition, toLike);
  if (!comparison) return null;
  return Prisma.sql`EXISTS (
    SELECT 1 FROM ${table} sc WHERE sc.gcf_id = g.gcf_id AND ${comparison}
  )`;
};

/**
 * A presence test on gcf_mibig_anchor; `false` is a real answer (NOT EXISTS),
 * as in the index's `term: {mibig_anchored}`.
 */
const buildMibigAnchoredCondition = (condition: FilterCondition): Prisma.Sql | null => {
  const raw = String(condition.value ?? '').toLowerCase();
  if (raw !== 'true' && raw !== 'false') return null;
  const wantAnchored = (raw === 'true') === (condition.operator !== 'not_equals');
  const exists = Prisma.sql`EXISTS (
    SELECT 1 FROM gcf_mibig_anchor a WHERE a.gcf_id = g.gcf_id
  )`;
  return wantAnchored ? exists : Prisma.sql`NOT ${exists}`;
};

/** 'seed' or 'fragmented' (NOT NULL), so not_equals is the other tier. */
const buildFamilyClassCondition = (condition: FilterCondition): Prisma.Sql | null => {
  const raw = String(condition.value ?? '').trim().toLowerCase();
  if (!isFamilyClass(raw)) return null;
  return condition.operator === 'not_equals'
    ? Prisma.sql`g.family_class <> ${raw}`
    : Prisma.sql`g.family_class = ${raw}`;
};

const envRow = (test: Prisma.Sql) => Prisma.sql`
  EXISTS (
    SELECT 1
    FROM gcf_environmental_distribution_mv env
    WHERE env.gcf_id = g.gcf_id
      AND (${test})
  )
`;

const BIOME_PRESENT = envRow(Prisma.sql`env.biome_level_1 IS NOT NULL
  OR env.biome_level_2 IS NOT NULL OR env.biome_level_3 IS NOT NULL`);

const buildBiomeCondition = (condition: FilterCondition): Prisma.Sql | null =>
  noneOrAny(condition, BIOME_PRESENT, (c) => {
    const comparisons = [
      buildTextCondition(Prisma.sql`env.biome_level_1`, c, toLike),
      buildTextCondition(Prisma.sql`env.biome_level_2`, c, toLike),
      buildTextCondition(Prisma.sql`env.biome_level_3`, c, toLike),
    ].filter((comparison): comparison is Prisma.Sql => comparison !== null);
    return comparisons.length ? envRow(Prisma.join(comparisons, ' OR ')) : null;
  });

// Each rank is compared on its own (a joined lineage string would break
// equals/starts_with/ends_with), as the index's taxonomy_terms does. A negative
// means no primary member has a matching rank; TAXONOMY_PRESENT mirrors the
// index's `exists` guard.
const TAXONOMY_RANK_COLUMNS = [
  Prisma.sql`t.domain`, Prisma.sql`t.phylum`, Prisma.sql`t.class`, Prisma.sql`t.order_name`,
  Prisma.sql`t.family`, Prisma.sql`t.genus`, Prisma.sql`t.species`,
];

const primaryMemberTaxon = (rankTest: Prisma.Sql) => Prisma.sql`
  EXISTS (
    SELECT 1
    FROM bgc_gcf bg
    JOIN bgc_taxonomy bt ON bt.bgc_id = bg.bgc_id
    JOIN taxonomies t ON t.id = bt.taxonomy_id
    WHERE bg.gcf_id = g.gcf_id
      AND bg.is_primary
      AND (${rankTest})
  )
`;

const TAXONOMY_PRESENT = primaryMemberTaxon(Prisma.join(
  TAXONOMY_RANK_COLUMNS.map((column) => Prisma.sql`COALESCE(${column}, '') <> ''`),
  ' OR ',
));

const buildTaxonomyCondition = (condition: FilterCondition): Prisma.Sql | null =>
  noneOrAny(condition, TAXONOMY_PRESENT, (c) => {
    const comparisons = TAXONOMY_RANK_COLUMNS
      .map((column) => buildTextCondition(Prisma.sql`COALESCE(${column}, '')`, c, toLike))
      .filter((comparison): comparison is Prisma.Sql => comparison !== null);
    return comparisons.length ? primaryMemberTaxon(Prisma.join(comparisons, ' OR ')) : null;
  });
