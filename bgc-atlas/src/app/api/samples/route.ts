import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

import prisma from '@/lib/prisma';
import { buildListCacheKeys, getOrSetCache } from '@/lib/cache';
import { parseAdvancedFilterParam } from '@/lib/filters/types';
import { buildAdvancedWhere } from '@/lib/filters/prisma-builders';
import { sampleFilterFields } from '@/lib/filters/field-definitions';
import { filterRefusalResponse, goldBucketRefusal, sourceTypeRefusal } from '@/lib/api/filter-refusal';
import { isBrowseSearchEnabled, searchBrowseIndex } from '@/lib/opensearch/browse-client';
import { hydrateSampleEnrichments } from '@/lib/api/sample-enrichments';
import { deepPageRefusal } from '@/lib/api/deep-page-refusal';
import { supportsBrowseSearch } from '@/lib/opensearch/browse-query';
import {
  buildBaseFilters,
  buildOuterFilters,
  buildSampleAdvancedCondition,
  mapSampleRowToSample,
  parseNumber,
  type SampleRow,
} from '@/lib/api/samples-query';
import { serverError } from '@/lib/api/errors';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// Physicochemical + genome-QC columns live on `samples`, not the sample_summary MV.
const SAMPLE_EXTRA_COLS = Prisma.sql`,
  s.salinity, s.salinity_unit, s.temperature, s.ph,
  s.dissolved_oxygen, s.dissolved_oxygen_unit,
  s.nitrate, s.nitrate_unit, s.nitrite, s.nitrite_unit,
  s.ammonium, s.ammonium_unit, s.phosphate, s.phosphate_unit,
  s.conductivity, s.conductivity_unit,
  s.dissolved_organic_carbon, s.dissolved_organic_carbon_unit,
  s.filtration_lower_threshold_um, s.filtration_upper_threshold_um,
  s.checkm_completeness, s.checkm_contamination, s.genome_size, s.genome_quality,
  -- Which tool and run the CheckM values came from; the index path carries them.
  s.checkm_tool, s.checkm_source`;

const sortFieldMap: Record<string, Prisma.Sql> = {
  id: Prisma.sql`COALESCE(sb.external_id, sb.id::text)`,
  dataSource: Prisma.sql`COALESCE((
    SELECT MIN(name)
    FROM UNNEST(sb.data_source_names) AS ds(name)
  ), '')` ,
  assemblies: Prisma.sql`sb.assembly_count`,
  bgcs: Prisma.sql`sb.bgc_count`,
  // No row in the counts MV means no BGCs; sort it as zero.
  gcfs: Prisma.sql`COALESCE(sgc.gcf_count, 0)`,
  location: Prisma.sql`COALESCE(sb.geographic_location, sb.geolocation_name, '')`,
  biome: Prisma.sql`COALESCE(sb.primary_biome, sb.environment_biome, '')`,
  environment: Prisma.sql`COALESCE(sb.environment_biome, '')`,
  material: Prisma.sql`COALESCE(sb.environment_material, '')`,
  feature: Prisma.sql`COALESCE(sb.environment_feature, '')`,
  host: Prisma.sql`COALESCE(sb.host_scientific_name, sb.host_taxid::text, '')`,
  study: Prisma.sql`COALESCE((
    SELECT MIN(title)
    FROM UNNEST(sb.study_titles) AS st(title)
  ), '')` ,
  // Genome QC is on `samples`; a scalar PK lookup rather than the data query's
  // `s` join, which the count query does not carry. NULLS LAST in buildOrderClause
  // matches OpenSearch, where a missing value sorts last in both directions.
  completeness: Prisma.sql`(SELECT q.checkm_completeness FROM samples q WHERE q.id = sb.id)`,
  contamination: Prisma.sql`(SELECT q.checkm_contamination FROM samples q WHERE q.id = sb.id)`,
  genomeQuality: Prisma.sql`(SELECT q.genome_quality FROM samples q WHERE q.id = sb.id)`,
};

const NULLS_LAST_SAMPLE_SORTS = new Set(['completeness', 'contamination', 'genomeQuality']);

/**
 * Sorts exempt from the `sb.id` paging tiebreaker. Empty: measured free for
 * every key here, since the COALESCE keys already sort the whole set and the
 * count indexes carry the id as their second column.
 */
const TIEBREAK_EXEMPT_SAMPLE_SORTS = new Set<string>();

function buildOrderClause(params: URLSearchParams) {
  const sortFieldParam = params.get('sortField') ?? 'bgcs';
  const sortOrderParam = params.get('sortOrder') === 'asc' ? 'asc' : 'desc';
  // hasOwn: ?sortField=constructor would otherwise bind as NULL (silently unordered).
  const sortColumn = Object.hasOwn(sortFieldMap, sortFieldParam) ? sortFieldMap[sortFieldParam] : sortFieldMap.bgcs;
  const direction = sortOrderParam === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const nulls = NULLS_LAST_SAMPLE_SORTS.has(sortFieldParam) ? Prisma.sql` NULLS LAST` : Prisma.empty;
  const order = Prisma.sql`ORDER BY ${sortColumn} ${direction}${nulls}`;
  // Deterministic paging: `id` sorts on a display id, so no key is unique.
  // ASC matches the OpenSearch path, so both backends return the same page.
  if (TIEBREAK_EXEMPT_SAMPLE_SORTS.has(sortFieldParam)) return order;
  return Prisma.sql`${order}, sb.id ASC`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = url.searchParams;

  const limit = parseNumber(params.get('limit'), { fallback: DEFAULT_LIMIT, clampMin: 1, clampMax: MAX_LIMIT }) ?? DEFAULT_LIMIT;
  const offset = parseNumber(params.get('offset'), { fallback: 0, clampMin: 0 }) ?? 0;

  // Opt-in (Genome Collections): the correlated subquery is not free.
  const includeGtdbAccession = ['1', 'true'].includes((params.get('includeGtdbAccession') ?? '').toLowerCase());
  const gtdbAccessionSelect = includeGtdbAccession
    ? Prisma.sql`, (
        SELECT COALESCE(a.external_id, a.accession, a.metadata->>'gtdb_genome_id')
        FROM sample_assemblies sa
        JOIN assemblies a ON a.id = sa.assembly_id
        WHERE sa.sample_id = sb.id
          AND COALESCE(a.external_id, a.accession, a.metadata->>'gtdb_genome_id') ~* '(GCF|GCA)_'
        ORDER BY sa.created_at ASC NULLS LAST
        LIMIT 1
      ) AS gtdb_accession`
    : Prisma.empty;

  // Opt-in: one lineage per genome from assembly_taxonomy (not an arbitrary BGC's;
  // ~1/8 of genomes carry several). Several assemblies per sample: best-supported
  // first, ties on id. gtdbLineage is NULL when the consensus is not a taxonomies row.
  const includeTaxonomy = ['1', 'true'].includes((params.get('includeTaxonomy') ?? '').toLowerCase());
  const taxonomySelect = includeTaxonomy
    ? Prisma.sql`, (
        SELECT jsonb_build_object(
          'domain', at.domain, 'phylum', at.phylum, 'class', at.class,
          'order', at.order_name, 'family', at.family, 'genus', at.genus,
          'species', at.species, 'gtdbLineage', t.gtdb_lineage
        )
        FROM sample_assemblies sa
        JOIN assembly_taxonomy at ON at.assembly_id = sa.assembly_id
        LEFT JOIN taxonomies t ON t.id = at.taxonomy_id
        WHERE sa.sample_id = sb.id
        ORDER BY at.n_bgcs DESC, at.assembly_id
        LIMIT 1
      ) AS taxonomy`
    : Prisma.empty;

  // Opt-in: the sample's studies, so the Study column can link to NCBI BioProject.
  const includeStudyLinks = ['1', 'true'].includes((params.get('includeStudyLinks') ?? '').toLowerCase());
  const studyLinksSelect = includeStudyLinks
    ? Prisma.sql`, (
        SELECT jsonb_agg(jsonb_build_object(
          'accession', st.accession, 'bioproject', st.bioproject, 'title', st.title
        ) ORDER BY st.title NULLS LAST)
        FROM study_samples ss
        JOIN studies st ON st.id = ss.study_id
        WHERE ss.sample_id = sb.id
      ) AS study_links`
    : Prisma.empty;

  // Checked before the index too: it answers an unknown source type with zero hits.
  const badSourceType = sourceTypeRefusal(params);
  if (badSourceType) return badSourceType;
  const badGoldBucket = goldBucketRefusal(params);
  if (badGoldBucket) return badGoldBucket;

  if (isBrowseSearchEnabled('samples') && supportsBrowseSearch('samples', params)) {
    try {
      const result = await searchBrowseIndex('samples', params);
      // The index lacks these enrichments; added before mapping so both paths
      // reach mapSampleRowToSample in the same shape.
      const documents = await hydrateSampleEnrichments(result.documents, {
        gtdbAccession: includeGtdbAccession,
        taxonomy: includeTaxonomy,
        studyLinks: includeStudyLinks,
      });
      return NextResponse.json({
        success: true,
        data: {
          data: documents.map((document) => mapSampleRowToSample(document as unknown as SampleRow)),
          total: result.total,
          limit,
          offset,
        },
      });
    } catch (error) {
      // A refused filter is a 400, not an outage (SQL would re-refuse after a
      // full-corpus scan). Returned, not thrown: this handler has no outer catch.
      const refusal = filterRefusalResponse(error);
      if (refusal) return refusal;
      console.error('OpenSearch samples browse query failed; falling back to PostgreSQL', error);
    }
  }

  // ?studyKey= has no SQL equivalent; reached only if the index threw or is
  // switched off (e.g. during a re-clustering cutover).
  if (params.has('studyKey')) {
    return NextResponse.json(
      {
        success: false,
        error: 'Study-filtered sample search unavailable',
        message: 'The samples index is unavailable; please retry.',
      },
      { status: 503 },
    );
  }

  // SQL paging cost follows the depth, so refuse deep pages here.
  const tooDeepForSql = deepPageRefusal(offset, limit);
  if (tooDeepForSql) return tooDeepForSql;

  // Refuse rather than widen on an unhonourable filter.
  let allFilters: Prisma.Sql[];
  let orderClause: Prisma.Sql;
  try {
    allFilters = [...buildBaseFilters(params), ...buildOuterFilters(params)];
    orderClause = buildOrderClause(params);

    const advancedGroup = parseAdvancedFilterParam(params.get('advancedFilters'));
    const advancedWhere = buildAdvancedWhere(
      advancedGroup,
      buildSampleAdvancedCondition,
      sampleFilterFields,
    );
    if (advancedWhere) {
      allFilters.push(advancedWhere);
    }
  } catch (error) {
    const refusal = filterRefusalResponse(error);
    if (refusal) return refusal;
    throw error;
  }

  const whereClause = allFilters.length
    ? Prisma.sql`WHERE ${Prisma.join(allFilters, ' AND ')}`
    : Prisma.sql``;

  const { dataKey, countKey } = buildListCacheKeys('samples:list', params, [
    'limit', 'offset', 'sortField', 'sortOrder', 'sortFields', 'sortOrders',
    // Affect selected columns only, not the row set.
    'includeGtdbAccession',
    'includeTaxonomy',
    'includeStudyLinks',
  ]);

  const fetchTotal = async (): Promise<number> => {
    const countResult = await prisma.$queryRaw<{ total: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS total
      FROM sample_summary sb
      -- Only for gcfsMin/gcfsMax; Postgres drops the 1:1 join when unused.
      LEFT JOIN sample_gcf_counts_mv sgc ON sgc.sample_id = sb.id
      ${whereClause}
    `);
    return countResult?.[0]?.total ?? 0;
  };

  const fetchData = async () => {
    const rows = await prisma.$queryRaw<SampleRow[]>(Prisma.sql`
      SELECT sb.*${SAMPLE_EXTRA_COLS}${gtdbAccessionSelect}${taxonomySelect}${studyLinksSelect},
             sgc.gcf_count, sgc.clustered_bgc_count, sgc.unclustered_bgc_count
      FROM sample_summary sb
      JOIN samples s ON s.id = sb.id
      -- LEFT: samples with no BGCs have no row.
      LEFT JOIN sample_gcf_counts_mv sgc ON sgc.sample_id = sb.id
      ${whereClause}
      ${orderClause}
      LIMIT ${limit}
      OFFSET ${offset}
    `);
    return rows.map(mapSampleRowToSample);
  };

  try {
    const [total, results] = await Promise.all([
      getOrSetCache(countKey, fetchTotal, 600),
      getOrSetCache(dataKey, fetchData, 60),
    ]);

    return NextResponse.json({
      success: true,
      data: { data: results, total, limit, offset },
    });
  } catch (error) {
    return serverError(error, 'Failed to load samples');
  }
}
