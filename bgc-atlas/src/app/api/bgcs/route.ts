import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { buildListCacheKeys, getOrSetCache } from '@/lib/cache';
import { advancedFilterRequires, advancedFilterTouches } from './advanced-filter-touches';
import {
  assemblyFilterForSamples,
  buildBgcAdvancedCondition,
  isValidUuid,
  toLike,
  toPrefixLike,
} from './advanced-condition';
import { parseBgcSearch } from '@/lib/bgc/search-text';
import { bgcFilterFields } from '@/lib/filters/field-definitions';
import { bgcFilterRefusal, filterRefusalResponse } from '@/lib/api/filter-refusal';
import { deepPageRefusal } from '@/lib/api/deep-page-refusal';
import { parseAdvancedFilterParam } from '@/lib/filters/types';
import { buildAdvancedWhereAsync } from '@/lib/filters/prisma-builders';
import { goldBucketSqlForColumn } from '@/lib/api/samples-query';
import { stripSourcePrefixes } from '@/lib/utils/sample-id';
import { collapseConsecutiveLevels } from '@/lib/utils/metadata-parser';
import {
  aggregateBrowseIndex, countBrowseIndex, isBrowseSearchEnabled, searchBrowseIndex,
  searchBrowseIndexWithBody, sortKeysBrowseIndex,
  isTransientBrowseError,
  isBrowseQueryRejection,
  browseQueryRejectionResponse,
  withBrowseTimeout,
} from '@/lib/opensearch/browse-client';
import {
  BROWSE_RESULT_WINDOW, countResolvedPageBody, isPastTheEnd, planCountResolvedPage,
  type PagedRequest,
} from '@/lib/opensearch/deep-paging';
import { buildBrowseSearchRequest, HYBRID_CLASS, supportsBrowseSearch } from '@/lib/opensearch/browse-query';
import { mapBgcBrowseDocument } from '@/lib/opensearch/bgc-browse-mapper';
import { withKnownClusterHits } from '@/lib/opensearch/known-cluster-decorations';
import { applySortFieldGuard } from '@/lib/bgc-sort';
import { serverError } from '@/lib/api/errors';
import { createConcurrencyGate, GateBusyError } from '@/lib/api/concurrency-gate';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Sort fields whose ORDER BY carries a key of its own; anything else already
 * falls through to `b.id`.
 */
const BGC_SORTS_WITH_OWN_KEY = new Set([
  'length', 'genes', 'gcf', 'distance', 'assembly',
  'type', 'class', 'completeness', 'name', 'biome', 'taxonomy',
]);

/**
 * One name per product sort. The table sends `type` / `class`; the index also takes
 * `product` / `category` and the pre-rename `productType` / `productCategory`, which
 * this path did not know and so sorted by id.
 */
const BGC_SORT_ALIASES: Record<string, string> = {
  product: 'type', productType: 'type', category: 'class', productCategory: 'class',
};

/**
 * Single-field sorts that skip the `b.id` paging tiebreaker because it costs the
 * index that supplies the ordering. `completeness` (a boolean) drops from ~10 ms
 * to a >20 s full sort with it; paging on it is therefore not deterministic.
 * An index on (is_complete, id) would fix that. SQL fallback only: the browse
 * index already applies the tiebreaker.
 */
const TIEBREAK_EXEMPT_BGC_SORTS = new Set<string>(['completeness']);

/**
 * ORDER BY key for an array column, the way the browse index orders it: a
 * multi-valued keyword sorts by its smallest element ascending and its largest
 * descending, in byte order (COLLATE "C": 'PKS' before 'other'), with empty arrays
 * last either way, so both backends return the same order. `column` is a fixed
 * column name, never request input.
 */
function arraySortKey(column: 'b.product' | 'b.product_category', order: 'ASC' | 'DESC'): string {
  const pick = order === 'ASC' ? 'min' : 'max';
  return `(SELECT ${pick}(v COLLATE "C") FROM unnest(${column}) v) ${order} NULLS LAST`;
}

/**
 * ORDER BY key for a text sort, the way the browse index orders it: byte order
 * (COLLATE "C"), missing last in both directions. The database collation (en_US)
 * sorts case and punctuation differently, so without it the two backends
 * disagree. The name sort has no NULLS clause: filename is NOT NULL, and a
 * DESC NULLS LAST could not walk idx_bgcs_filename_c backwards.
 */
const BIOME_SORT_KEY = `COALESCE(bbs.resolved_biome_level_1, bbs.environment_biome, bbs.environment_feature, bbs.environment_material)`;
const TAXONOMY_SORT_KEY = `COALESCE(t.species, t.genus, t.family, t.order_name, t.class, t.phylum, t.domain)`;
function textSortKey(expr: string, order: string, nullable = true): string {
  return `${expr} COLLATE "C" ${order}${nullable ? ' NULLS LAST' : ''}`;
}

/**
 * Whether the single-field ORDER BY needs `b.id ASC` appended. No sort key is
 * unique, so without it a plan change can serve a row on two pages. ASC matches
 * the OpenSearch path, so both backends return the same page for one URL.
 */
function needsIdTiebreak(field: string): boolean {
  return BGC_SORTS_WITH_OWN_KEY.has(field) && !TIEBREAK_EXEMPT_BGC_SORTS.has(field);
}

// The complete set of distinct product types/categories: the matrix MV plus a
// scan of BGCs with no GCF (which the MV omits). Completeness lets a free-text
// term resolve to exact GIN-servable values, or short-circuit to empty.
async function getProductFacets(): Promise<{ types: string[]; categories: string[] }> {
  return getOrSetCache('bgcs:product-facets-v3', async () => {
    const [mv, nogcf] = await Promise.all([
      prisma.$queryRaw<{ types: string[] | null; categories: string[] | null }[]>(Prisma.sql`
        SELECT
          array_agg(DISTINCT product) FILTER (WHERE product IS NOT NULL) AS types,
          array_agg(DISTINCT product_category) FILTER (WHERE product_category IS NOT NULL) AS categories
        FROM gcf_product_type_matrix_mv
      `),
      // Only types can be no-GCF-only; all categories occur in GCF'd BGCs.
      // "no GCF" = no bgc_gcf row at all.
      prisma.$queryRaw<{ types: string[] | null }[]>(Prisma.sql`
        SELECT array_agg(DISTINCT t) AS types
        FROM (
          SELECT unnest(product) t FROM bgcs b
          WHERE NOT EXISTS (SELECT 1 FROM bgc_gcf bg WHERE bg.bgc_id = b.id)
        ) x
      `),
    ]);
    const types = Array.from(new Set([...(mv[0]?.types ?? []), ...(nogcf[0]?.types ?? [])]));
    const categories = mv[0]?.categories ?? [];
    return { types, categories };
    // Flush 'bgcs:product-facets-v3' after a reload that introduces new product types.
  }, 604800);
}

// Precomputed BGC count per product / product_category, keyed `${kind}:${value}`,
// so the COUNT for a sole product filter is a lookup.
async function getProductFacetCounts(): Promise<Map<string, number>> {
  const entries = await getOrSetCache<[string, number][]>('bgcs:product-facet-counts-v4', async () => {
    const rows = await prisma.$queryRaw<{ kind: string; value: string; bgc_count: bigint }[]>(Prisma.sql`
      SELECT kind, value, bgc_count FROM bgc_product_facet_counts
    `);
    return rows.map((r) => [`${r.kind}:${r.value}`, Number(r.bgc_count)] as [string, number]);
  }, 604800);
  return new Map(entries);
}

// A single exact product value whose count can come from the MV when it is the only filter.
type SoleProduct = { kind: 'product' | 'category'; value: string };

// Precomputed BGC count per GOLD bucket / data source. These filters go through
// sample_assemblies and the COUNT is the expensive part (~35s vs ~7s for the page).
// A data load must refresh both matviews and flush these keys.
async function getGoldBucketCounts(): Promise<Map<string, number>> {
  const entries = await getOrSetCache<[string, number][]>('bgcs:gold-bucket-counts-v1', async () => {
    const rows = await prisma.$queryRaw<{ bucket: string; bgc_count: bigint }[]>(Prisma.sql`
      SELECT bucket, bgc_count FROM bgc_gold_bucket_counts
    `);
    return rows.map((r) => [r.bucket, Number(r.bgc_count)] as [string, number]);
  }, 604800);
  return new Map(entries);
}

async function getDataSourceCounts(): Promise<Map<string, number>> {
  const entries = await getOrSetCache<[string, number][]>('bgcs:data-source-counts-v3', async () => {
    const rows = await prisma.$queryRaw<{ data_source: string; bgc_count: bigint }[]>(Prisma.sql`
      SELECT data_source, bgc_count FROM bgc_data_source_counts
    `);
    return rows.map((r) => [r.data_source, Number(r.bgc_count)] as [string, number]);
  }, 604800);
  return new Map(entries);
}

// WHERE condition for a free-text type term: resolves it against the complete
// facet list to a GIN array-overlap equivalent to an unnest+ILIKE. No match ->
// `false`. `single` is set when it resolves to exactly one value.
async function buildProductTextFilter(term: string): Promise<{ sql: Prisma.Sql; single: SoleProduct | null }> {
  const { types } = await getProductFacets();
  if (types.length === 0) {
    const like = toLike(term);
    return {
      sql: Prisma.sql`EXISTS (SELECT 1 FROM unnest(b.product) pt WHERE pt ILIKE ${like})`,
      single: null,
    };
  }
  const needle = term.toLowerCase();
  const matchedTypes = types.filter((t) => t.toLowerCase().includes(needle));
  if (matchedTypes.length === 0) return { sql: Prisma.sql`false`, single: null };
  const sql = Prisma.sql`b.product && ARRAY[${Prisma.join(matchedTypes.map((t) => Prisma.sql`${t}`))}]::text[]`;
  const single: SoleProduct | null =
    matchedTypes.length === 1 ? { kind: 'product', value: matchedTypes[0] } : null;
  return { sql, single };
}

// Max family ids inlined for a ?gcf=<name> lookup; only a very short prefix exceeds it.
const GCF_NAME_INLINE_CAP = 2000;

const parseNumber = (value: string | null, options: { fallback?: number; clampMin?: number; clampMax?: number } = {}) => {
  if (!value) return undefined;
  const num = Number(value);
  if (!Number.isFinite(num)) return options.fallback;
  let result = num;
  if (options.clampMin !== undefined && result < options.clampMin) result = options.clampMin;
  if (options.clampMax !== undefined && result > options.clampMax) result = options.clampMax;
  return result;
};

/**
 * The SQL fallback, guarded. It runs when the browse index cannot answer (down,
 * stalled, or switched off during a re-clustering cutover), and then every /bgcs
 * request takes it. A box query on cold storage can need tens of thousands of
 * random reads, and a few of those held for the full statement timeout starve
 * the connection pool for the whole site. So: at most two fallback requests at
 * once (each uses two connections, count and page), a caller over that waits
 * 10 s for a slot, and each query gets 45 s. What does not fit gets a 503 that
 * says why.
 */
const FALLBACK_GATE = createConcurrencyGate(2, 10_000);
const FALLBACK_STATEMENT_TIMEOUT = '45s';
const FALLBACK_BUSY_MESSAGE =
  'The search index is temporarily unavailable and the backup search is busy. Please try again in a minute.';
const FALLBACK_TIMEOUT_MESSAGE =
  'The search index is temporarily unavailable, and this search is too large for the backup to answer in time. '
  + 'Try a smaller area or fewer filters, or try again shortly.';

/** Per-call budget for the one retry after a transient index failure. Index answers
 *  take 0.1-0.3 s; 5 s rides out a stall without stacking long waits. */
const BROWSE_RETRY_TIMEOUT_MS = 5_000;

async function withFallbackTimeout<T>(query: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  // SET LOCAL ends with the transaction, so the pooled connection goes back as it was.
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '${FALLBACK_STATEMENT_TIMEOUT}'`);
    return query(tx);
  }, { timeout: 50_000, maxWait: 10_000 });
}

/** A query cancelled by statement_timeout (SQLSTATE 57014), as Prisma reports a raw query's failure. */
function isStatementTimeout(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  const meta = error.meta as { code?: unknown } | undefined;
  return meta?.code === '57014' || /statement timeout/i.test(error.message);
}

// userFacing: the client shows a 503's text only when it says so (api-client.ts).
const fallbackUnavailable = (message: string) => NextResponse.json(
  { success: false, error: message, userFacing: true },
  { status: 503, headers: { 'Retry-After': '30' } },
);
const RESOLVER_PROBE_LOG_THRESHOLD = 20;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const params = url.searchParams;

    const limit = parseNumber(params.get('limit'), { fallback: DEFAULT_LIMIT, clampMin: 1, clampMax: MAX_LIMIT }) ?? DEFAULT_LIMIT;
    const offset = parseNumber(params.get('offset'), { fallback: 0, clampMin: 0 }) ?? 0;

    // Before either backend, so both refuse the same URL: an unknown goldBucket
    // matched nothing on the index while the SQL below dropped it, an unknown
    // sourceType gave an empty table, and an unknown completeness (`unknown`
    // included) was ignored by both -- the whole corpus.
    const badFilter = bgcFilterRefusal(params);
    if (badFilter) return badFilter;

    if (isBrowseSearchEnabled('bgcs') && supportsBrowseSearch('bgcs', params)) {
      const serveFromIndex = async (): Promise<NextResponse> => {
        // Past from+size = 10,000 the index refuses and the SQL fallback times
        // out, so resolve the rank by counting. Returns null when it cannot.
        const resolved = await planCountResolvedPage(
          buildBrowseSearchRequest('bgcs', params) as unknown as PagedRequest,
          (query: Record<string, unknown>) => countBrowseIndex('bgcs', query),
          (body: Record<string, unknown>) => sortKeysBrowseIndex('bgcs', body),
          (body: Record<string, unknown>) => aggregateBrowseIndex('bgcs', body),
        );
        // Past the last match: an empty page with the real total, not the
        // deep-page refusal, so the pager can snap back into range.
        if (isPastTheEnd(resolved)) {
          return NextResponse.json({
            success: true,
            data: { data: [], total: resolved.total, limit, offset },
          });
        }
        if (resolved) {
          const page = await searchBrowseIndexWithBody('bgcs', countResolvedPageBody(resolved));
          // sliceFrom is non-zero only on the walked path, where `from` is refused.
          const rows = page.documents.slice(resolved.sliceFrom).map(mapBgcBrowseDocument);
          if (resolved.probes > RESOLVER_PROBE_LOG_THRESHOLD) {
            console.warn(
              `BGC deep page at offset ${offset} resolved in ${resolved.probes} probes `
              + `(sort=${params.get('sortField') ?? params.get('sortFields') ?? 'default'})`,
            );
          }
          return NextResponse.json({
            success: true,
            // The body's own hit count only covers documents from the boundary down.
            data: { data: await withKnownClusterHits(rows), total: resolved.total, limit, offset },
          });
        }

        // searchBrowseIndex pages with from/size, which the index refuses past the window.
        if (offset + limit > BROWSE_RESULT_WINDOW) {
          const refusal = deepPageRefusal(offset, limit);
          if (refusal) return refusal;
        }

        const result = await searchBrowseIndex('bgcs', params);
        const rows = result.documents.map(mapBgcBrowseDocument);
        return NextResponse.json({
          success: true,
          data: { data: await withKnownClusterHits(rows), total: result.total, limit, offset },
        });
      };
      try {
        return await serveFromIndex();
      } catch (error) {
        // A refused filter is a 400, not an outage; falling through would re-refuse
        // after a full-corpus scan.
        if (filterRefusalResponse(error)) throw error;
        // So is a value the index cannot use: the fallback reached a 503 after 45 s.
        if (isBrowseQueryRejection(error)) return browseQueryRejectionResponse(error, 'BGC browse');
        if (!isTransientBrowseError(error)) {
          console.error('OpenSearch BGC browse query failed; falling back to PostgreSQL', error);
        } else {
          // A stall or a dropped connection, not a refusal: one more try, on a short
          // budget, costs at most a few seconds where the fallback can cost 45.
          console.warn('OpenSearch BGC browse query failed transiently; retrying once', error);
          try {
            return await withBrowseTimeout(BROWSE_RETRY_TIMEOUT_MS, serveFromIndex);
          } catch (retryError) {
            if (filterRefusalResponse(retryError)) throw retryError;
            if (isBrowseQueryRejection(retryError)) {
              return browseQueryRejectionResponse(retryError, 'BGC browse');
            }
            console.error('OpenSearch BGC browse retry failed; falling back to PostgreSQL', retryError);
          }
        }
      }
    }

    // SQL paging cost follows the depth (offset 50,000 hits the 120s timeout),
    // so refuse deep pages here.
    const tooDeepForSql = deepPageRefusal(offset, limit);
    if (tooDeepForSql) return tooDeepForSql;

    const filters: Prisma.Sql[] = [];
    let soleProduct: SoleProduct | null = null;
    // Precomputed-count shortcuts, valid only when the filter is the only one.
    let soleGoldBucket: string | null = null;
    let soleDataSource: string | null = null;
    // Tables referenced by WHERE, so the COUNT can skip unused joins.
    const filterTouches = { bbs: false, t: false, asm: false, bg: false };
    // Whether each join may be INNER (see advancedFilterRequires): INNER is
    // affordable but drops BGCs with no row in the joined table.
    const innerJoin = { bbs: false, t: false, asm: false };
    // The gcf filter rides the `bg` join so the planner can drive off idx_bgc_gcf_thr_gcf.
    let gcfJoinCond: Prisma.Sql = Prisma.empty;

    // Matched by the same rule as the OpenSearch path (lib/bgc/search-text.ts): a
    // UUID exactly, the identifiers by prefix, the rest by "contains".
    const search = parseBgcSearch(params.get('search') ?? '');
    if (search) {
      const like = toLike(search.kind === 'text' ? search.text : search.uuid);
      const prefix = toPrefixLike(search.kind === 'text' ? search.text : search.uuid);
      const identifiers = search.kind === 'uuid'
        ? Prisma.sql`b.id = ${search.uuid}::uuid OR b.assembly = ${search.uuid}::uuid`
        : Prisma.sql`b.id::text ILIKE ${prefix}
        OR b.filename ILIKE ${prefix}
        OR b.assembly::text ILIKE ${prefix}
        OR b.contig ILIKE ${prefix}`;
      const described = search.kind === 'uuid'
        ? Prisma.sql`FALSE`
        : Prisma.sql`bbs.resolved_biome_level_1 ILIKE ${like}
        OR bbs.resolved_biome_level_2 ILIKE ${like}
        OR bbs.resolved_biome_level_3 ILIKE ${like}
        OR bbs.resolved_biome_level_4 ILIKE ${like}
        OR bbs.environment_biome ILIKE ${like}
        OR bbs.environment_feature ILIKE ${like}
        OR bbs.environment_material ILIKE ${like}
        OR EXISTS (SELECT 1 FROM unnest(b.product_category) pc WHERE pc ILIKE ${like})
        OR EXISTS (SELECT 1 FROM unnest(b.product) pt WHERE pt ILIKE ${like})
        OR EXISTS (
          SELECT 1
          FROM sample_assemblies sa
          JOIN samples s ON s.id = sa.sample_id
          WHERE sa.assembly_id = b.assembly
            AND (s.external_id ILIKE ${like} OR s.name ILIKE ${like})
        )`;
      filters.push(Prisma.sql`(${identifiers} OR ${described})`);
      filterTouches.bbs = true;
      // INNER although this OR doesn't uniformly constrain bbs: ?search= is a hot
      // path and LEFT would cost it the pushdown.
      innerJoin.bbs = true;
    }

    const idFilter = params.get('id');
    if (idFilter && idFilter.trim()) {
      const like = toLike(idFilter.trim());
      filters.push(Prisma.sql`(b.id::text ILIKE ${like})`);
    }

    const nameFilter = params.get('name');
    if (nameFilter && nameFilter.trim()) {
      const like = toLike(nameFilter.trim());
      filters.push(Prisma.sql`b.filename ILIKE ${like}`);
    }

    const assemblyFilter = params.get('assembly');
    if (assemblyFilter && assemblyFilter.trim()) {
      const val = assemblyFilter.trim();
      if (isValidUuid(val)) {
        filters.push(Prisma.sql`b.assembly = ${val}::uuid`);
      } else {
        const like = toLike(val);
        filters.push(Prisma.sql`(b.assembly::text ILIKE ${like})`);
      }
    }

    const gcfFilter = params.get('gcf');
    if (gcfFilter && gcfFilter.trim()) {
      const val = gcfFilter.trim();
      // Expressed as a JOIN predicate, not WHERE EXISTS: with EXISTS the planner can
      // defer the semi-join past the ORDER BY input, and the `taxonomy` sort then
      // seq-scans the corpus (>150 s vs ~1.5 s).
      //
      // bgc_gcf is not unique per BGC; `AND bg.is_primary` keeps this INNER JOIN
      // from silently inflating counts, and matches the primary-only /gcfs counts.
      filterTouches.bg = true;
      if (isValidUuid(val)) {
        gcfJoinCond = Prisma.sql`AND bg.gcf_id = ${val}::uuid`;
      } else {
        // ?gcf= matches the family name too, since the column shows `gcfName || gcf`.
        // Resolved in a separate round trip and inlined as literal uuids: a subquery
        // makes the planner sort the whole corpus, and the COUNT doesn't join gcfs.
        // Not pet_name: bgc_browse has no such field.
        const like = toLike(val);
        // Exact match first (rides gcfs_name_key); ILIKE scans every family (~1-4.5 s).
        let named = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
          SELECT id::text AS id FROM gcfs WHERE name = ${val} LIMIT 1
        `);
        if (!named.length) {
          named = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
            SELECT id::text AS id FROM gcfs WHERE name ILIKE ${like} LIMIT ${GCF_NAME_INLINE_CAP + 1}
          `);
        }
        if (!named.length) {
          // Fall back to id-substring matching so a partial uuid still resolves.
          gcfJoinCond = Prisma.sql`AND bg.gcf_id::text ILIKE ${like}`;
        } else if (named.length <= GCF_NAME_INLINE_CAP) {
          gcfJoinCond = Prisma.sql`AND bg.gcf_id IN (${Prisma.join(
            named.map((r) => Prisma.sql`${r.id}::uuid`)
          )})`;
        } else {
          // Too broad to enumerate; the semi-join is bounded by gcfs, not the corpus.
          gcfJoinCond = Prisma.sql`AND EXISTS (
            SELECT 1 FROM gcfs g2 WHERE g2.id = bg.gcf_id AND g2.name ILIKE ${like}
          )`;
        }
      }
    }

    // The Category dropdown sends one of the 6 exact categories, so array
    // containment hits idx_bgcs_product_category_gin (~40s -> ~0.4s).
    const classFilter = params.get('category') ?? params.get('class');
    if (classFilter && classFilter.trim()) {
      const cat = classFilter.trim();
      if (cat === HYBRID_CLASS) {
        // "Hybrid" is a display label for multi-category regions, not a stored
        // value. cardinality() can't use the GIN index, but this path only runs
        // with ?advancedFilters (already a seq scan). Not soleProduct: no Hybrid row.
        filters.push(Prisma.sql`cardinality(b.product_category) > 1`);
      } else {
        filters.push(Prisma.sql`b.product_category @> ARRAY[${cat}]::text[]`);
        soleProduct = { kind: 'category', value: cat };
      }
    }

    // Free text over b.product alone (not product_category).
    const productText = params.get('product') ?? params.get('typeText');
    if (productText && productText.trim()) {
      const { sql, single } = await buildProductTextFilter(productText.trim());
      filters.push(sql);
      soleProduct = single;
    }

    // The expression must exactly match idx_bbs_biome_concat_trgm (column order,
    // separator, COALESCE wrapping).
    const biomeFilter = params.get('biome');
    if (biomeFilter && biomeFilter.trim()) {
      const like = toLike(biomeFilter.trim());
      filters.push(Prisma.sql`(
        COALESCE(bbs.resolved_biome_level_1, '') || ' ' ||
        COALESCE(bbs.resolved_biome_level_2, '') || ' ' ||
        COALESCE(bbs.resolved_biome_level_3, '') || ' ' ||
        COALESCE(bbs.resolved_biome_level_4, '') || ' ' ||
        COALESCE(bbs.environment_biome, '') || ' ' ||
        COALESCE(bbs.environment_feature, '') || ' ' ||
        COALESCE(bbs.environment_material, '')
      ) ILIKE ${like}`);
      filterTouches.bbs = true;
      innerJoin.bbs = true;
    }

    // Both go through assemblyFilterForSamples; a correlated subquery sorts the corpus.
    const sampleId = params.get('sampleId');
    if (sampleId && sampleId.trim()) {
      const val = sampleId.trim();
      filters.push(
        await assemblyFilterForSamples(
          isValidUuid(val)
            ? Prisma.sql`sa.sample_id = ${val}::uuid`
            : Prisma.sql`sa.sample_id::text ILIKE ${toLike(val)}`
        )
      );
    }

    const sampleText = params.get('sample');
    if (sampleText && sampleText.trim()) {
      const like = toLike(sampleText.trim());
      filters.push(
        await assemblyFilterForSamples(
          Prisma.sql`(s.external_id ILIKE ${like} OR s.name ILIKE ${like})`
        )
      );
    }

    const dataSource = params.get('dataSource');
    if (dataSource && dataSource.trim()) {
      const dsValue = dataSource.trim();
      const like = toLike(dsValue);
      // A substring match: the precomputed count only applies when exactly one
      // known source name contains it.
      const dsMatches = [...(await getDataSourceCounts()).keys()].filter((name) =>
        name.toLowerCase().includes(dsValue.toLowerCase())
      );
      if (dsMatches.length === 1) soleDataSource = dsMatches[0];
      filters.push(Prisma.sql`
        EXISTS (
          SELECT 1
          FROM sample_assemblies sa
          JOIN sample_summary ss ON ss.id = sa.sample_id
          CROSS JOIN LATERAL unnest(ss.data_source_names) AS dn
          WHERE sa.assembly_id = b.assembly
            AND dn ILIKE ${like}
        )
      `);
    }

    // Bounding box (+ optional GOLD bucket), from the map's "select area" tool.
    const latMin = parseNumber(params.get('latMin'));
    const latMax = parseNumber(params.get('latMax'));
    const lonMin = parseNumber(params.get('lonMin'));
    const lonMax = parseNumber(params.get('lonMax'));
    const geoConds: Prisma.Sql[] = [];
    if (latMin !== undefined) geoConds.push(Prisma.sql`s.latitude >= ${latMin}`);
    if (latMax !== undefined) geoConds.push(Prisma.sql`s.latitude <= ${latMax}`);
    if (lonMin !== undefined) geoConds.push(Prisma.sql`s.longitude >= ${lonMin}`);
    if (lonMax !== undefined) geoConds.push(Prisma.sql`s.longitude <= ${lonMax}`);

    const bgcGoldBucket = params.get('goldBucket');
    const bucketCond = bgcGoldBucket && bgcGoldBucket.trim()
      ? goldBucketSqlForColumn(bgcGoldBucket.trim(), Prisma.sql`s.gold_ecosystem_path`)
      : null;

    // ?sourceType= (repeatable): the assembly's source type -- the OpenSearch
    // path's assembly_source_type is assemblies.source_type. Beside a box or a
    // bucket it is a JOIN inside that EXISTS, not an EXISTS of its own: as a second
    // subquery on b.assembly the planner dropped the box's nested loop and a
    // 51,416-BGC box hit the 120 s statement_timeout.
    const sourceTypes = params.getAll('sourceType').map((v) => v.trim()).filter(Boolean);
    const sourceTypeCond = sourceTypes.length
      ? Prisma.sql`st_a.source_type IN (${Prisma.join(sourceTypes)})`
      : null;

    if (geoConds.length > 0 || bucketCond) {
      // Only a bare bucket can use the precomputed count; a bbox or a source type
      // makes it an intersection.
      if (bucketCond && geoConds.length === 0 && !sourceTypeCond) soleGoldBucket = bgcGoldBucket!.trim();
      const sampleConds = [...geoConds];
      if (bucketCond) sampleConds.push(bucketCond);
      if (sourceTypeCond) sampleConds.push(sourceTypeCond);
      filters.push(Prisma.sql`
        EXISTS (
          SELECT 1
          FROM sample_assemblies sa
          JOIN samples s ON s.id = sa.sample_id
          ${sourceTypeCond ? Prisma.sql`JOIN assemblies st_a ON st_a.id = sa.assembly_id` : Prisma.empty}
          WHERE sa.assembly_id = b.assembly
            AND ${Prisma.join(sampleConds, ' AND ')}
        )
      `);
    } else if (sourceTypeCond) {
      filters.push(Prisma.sql`
        EXISTS (SELECT 1 FROM assemblies st_a WHERE st_a.id = b.assembly AND ${sourceTypeCond})
      `);
    }

    const completeness = params.get('completeness');
    if (completeness && completeness.trim()) {
      if (completeness === 'complete') {
        filters.push(Prisma.sql`b.is_complete = true`);
      } else if (completeness === 'partial') {
        filters.push(Prisma.sql`b.is_complete = false`);
      }
    }

    const lengthMin = parseNumber(params.get('lengthMin'));
    if (lengthMin !== undefined) {
      filters.push(Prisma.sql`(b.end_pos - b.start_pos) >= ${lengthMin}`);
    }
    const lengthMax = parseNumber(params.get('lengthMax'));
    if (lengthMax !== undefined) {
      filters.push(Prisma.sql`(b.end_pos - b.start_pos) <= ${lengthMax}`);
    }

    const genesMin = parseNumber(params.get('genesMin'));
    if (genesMin !== undefined) {
      filters.push(Prisma.sql`b.num_cds_features IS NOT NULL AND b.num_cds_features >= ${genesMin}`);
    }
    const genesMax = parseNumber(params.get('genesMax'));
    if (genesMax !== undefined) {
      filters.push(Prisma.sql`b.num_cds_features IS NOT NULL AND b.num_cds_features <= ${genesMax}`);
    }

    // Raw BiG-SLiCE distance of the primary family (lower = better), no 0..100 scaling.
    const distanceMin = parseNumber(params.get('distanceMin'));
    if (distanceMin !== undefined) {
      filters.push(Prisma.sql`EXISTS (SELECT 1 FROM bgc_gcf bgf WHERE bgf.bgc_id = b.id AND bgf.is_primary AND bgf.distance >= ${distanceMin})`);
    }
    const distanceMax = parseNumber(params.get('distanceMax'));
    if (distanceMax !== undefined) {
      filters.push(Prisma.sql`EXISTS (SELECT 1 FROM bgc_gcf bgf WHERE bgf.bgc_id = b.id AND bgf.is_primary AND bgf.distance <= ${distanceMax})`);
    }

    // Representative path on assembly_samples_mv (one per assembly).
    const goldEcosystem = params.get('goldEcosystem');
    if (goldEcosystem && goldEcosystem.trim()) {
      const like = toLike(goldEcosystem.trim());
      filters.push(Prisma.sql`asm.gold_ecosystem_path ILIKE ${like}`);
      filterTouches.asm = true;
      // INNER is always sound here: an ILIKE cannot match a BGC with no asm row.
      innerJoin.asm = true;
    }

    // The expression must exactly match idx_taxonomies_concat_trgm.
    const taxonomy = params.get('taxonomy');
    if (taxonomy && taxonomy.trim()) {
      const like = toLike(taxonomy.trim());
      filters.push(Prisma.sql`(
        COALESCE(t.domain, '') || ' ' ||
        COALESCE(t.phylum, '') || ' ' ||
        COALESCE(t.class, '') || ' ' ||
        COALESCE(t.order_name, '') || ' ' ||
        COALESCE(t.family, '') || ' ' ||
        COALESCE(t.genus, '') || ' ' ||
        COALESCE(t.species, '') || ' ' ||
        COALESCE(t.gtdb_lineage, '')
      ) ILIKE ${like}`);
      filterTouches.t = true;
      innerJoin.t = true;
    }

    const advancedGroup = parseAdvancedFilterParam(params.get('advancedFilters'));
    // Refuses rather than widens; the handler's catch turns it into a 400.
    const advancedWhere = await buildAdvancedWhereAsync(
      advancedGroup,
      buildBgcAdvancedCondition,
      bgcFilterFields,
    );
    if (advancedWhere) {
      filters.push(advancedWhere);
      // Only the joins the conditions name (see advancedFilterTouches).
      // `||`, never `=`: ?taxonomy=, ?biome= and ?search= already pushed bare
      // `t.`/`bbs.` predicates, and losing their join is a 500.
      const touched = advancedFilterTouches(advancedGroup);
      filterTouches.bbs = filterTouches.bbs || touched.bbs;
      filterTouches.t = filterTouches.t || touched.t;
      filterTouches.asm = filterTouches.asm || touched.asm;
      // INNER stays sound if a URL-param conjunct or every advanced branch
      // requires the table. Exception: ?search= sets innerJoin.bbs without
      // requiring a row, so with an OR advanced filter it still narrows. Accepted.
      const requires = advancedFilterRequires(advancedGroup);
      innerJoin.bbs = innerJoin.bbs || requires.bbs;
      innerJoin.t = innerJoin.t || requires.t;
      innerJoin.asm = innerJoin.asm || requires.asm;
    }

    const where = filters.length > 0 ? Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}` : Prisma.empty;

    // Multi-field: sortFields=length,completeness&sortOrders=desc,desc
    // Single-field: sortField=length&sortOrder=desc
    const sortFieldsParam = params.get('sortFields');
    const sortOrdersParam = params.get('sortOrders');
    const singleSortField = params.get('sortField');
    const singleSortOrder = params.get('sortOrder');

    let sortFields: string[];
    let sortOrders: ('ASC' | 'DESC')[];

    // An unspecified direction defaults to DESC, matching the index's
    // `defaultOrder`, so one URL returns the same end on both backends.
    if (sortFieldsParam && sortOrdersParam) {
      sortFields = sortFieldsParam.split(',').map(f => f.trim());
      sortOrders = sortOrdersParam.split(',').map(o => (o.trim().toLowerCase() === 'asc' ? 'ASC' : 'DESC'));
      // Pad with DESC, matching the index.
      while (sortOrders.length < sortFields.length) {
        sortOrders.push('DESC');
      }
    } else if (singleSortField) {
      sortFields = [singleSortField];
      sortOrders = [singleSortOrder === 'asc' ? 'ASC' : 'DESC'];
    } else {
      sortFields = ['length', 'completeness'];
      sortOrders = ['DESC', 'DESC'];
    }

    sortFields = sortFields.map((f) => (Object.hasOwn(BGC_SORT_ALIASES, f) ? BGC_SORT_ALIASES[f] : f));

    // Drop sorts that would order the whole corpus when nothing narrows the set
    // (`taxonomy` has no index); the default ordering is used instead.
    {
      const guarded = applySortFieldGuard(
        sortFields,
        sortOrders,
        filters.length > 0 || filterTouches.bg,
      );
      if (guarded.dropped.length > 0) {
        console.warn(
          `[api/bgcs] dropped unnarrowed scan-heavy sort: ${guarded.dropped.join(', ')}`,
        );
        sortFields = guarded.fields;
        sortOrders = guarded.orders as ('ASC' | 'DESC')[];
        if (sortFields.length === 0) {
          sortFields = ['length', 'completeness'];
          sortOrders = ['DESC', 'DESC'];
        }
      }
    }

    let orderBy: Prisma.Sql;

    if (sortFields.length === 0) {
      // b.id is the primary key, so no tiebreaker is needed.
      orderBy = Prisma.sql`ORDER BY b.id ASC`;
    } else if (sortFields.length === 1) {
      const field = sortFields[0];
      const order = sortOrders[0];
      switch (field) {
        case 'length':
          orderBy = Prisma.sql`ORDER BY (b.end_pos - b.start_pos) ${Prisma.raw(order)}`;
          break;
        case 'genes':
          orderBy = Prisma.sql`ORDER BY b.num_cds_features ${Prisma.raw(order)}`;
          break;
        case 'gcf':
          orderBy = Prisma.sql`ORDER BY bg.gcf_id ${Prisma.raw(order)}`;
          break;
        case 'distance':
          orderBy = Prisma.sql`ORDER BY bg.distance ${Prisma.raw(order)} NULLS LAST`;
          break;
        case 'assembly':
          orderBy = Prisma.sql`ORDER BY b.assembly ${Prisma.raw(order)}`;
          break;
        case 'type':
          orderBy = Prisma.sql`ORDER BY ${Prisma.raw(arraySortKey('b.product', order))}`;
          break;
        case 'class':
          orderBy = Prisma.sql`ORDER BY ${Prisma.raw(arraySortKey('b.product_category', order))}`;
          break;
        case 'completeness':
          orderBy = Prisma.sql`ORDER BY b.is_complete ${Prisma.raw(order)}`;
          break;
        case 'name':
          orderBy = Prisma.raw(`ORDER BY ${textSortKey('b.filename', order, false)}`);
          break;
        case 'biome':
          orderBy = Prisma.raw(`ORDER BY ${textSortKey(BIOME_SORT_KEY, order)}`);
          break;
        case 'taxonomy':
          orderBy = Prisma.raw(`ORDER BY ${textSortKey(TAXONOMY_SORT_KEY, order)}`);
          break;
        default:
          orderBy = Prisma.sql`ORDER BY b.id ${Prisma.raw(order)}`;
          break;
      }
      if (needsIdTiebreak(field)) {
        orderBy = Prisma.sql`${orderBy}, b.id ASC`;
      }
    } else {
      const orderParts: string[] = [];
      for (let i = 0; i < sortFields.length; i++) {
        const field = sortFields[i];
        const order = sortOrders[i];
        switch (field) {
          case 'length':
            orderParts.push(`(b.end_pos - b.start_pos) ${order}`);
            break;
          case 'genes':
            orderParts.push(`b.num_cds_features ${order}`);
            break;
          case 'gcf':
            orderParts.push(`bg.gcf_id ${order}`);
            break;
          case 'distance':
            orderParts.push(`bg.distance ${order} NULLS LAST`);
            break;
          case 'assembly':
            orderParts.push(`b.assembly ${order}`);
            break;
          case 'type':
            orderParts.push(arraySortKey('b.product', order));
            break;
          case 'class':
            orderParts.push(arraySortKey('b.product_category', order));
            break;
          case 'completeness':
            orderParts.push(`b.is_complete ${order}`);
            break;
          case 'name':
            orderParts.push(textSortKey('b.filename', order, false));
            break;
          case 'biome':
            orderParts.push(textSortKey(BIOME_SORT_KEY, order));
            break;
          case 'taxonomy':
            orderParts.push(textSortKey(TAXONOMY_SORT_KEY, order));
            break;
          default:
            orderParts.push(`b.id ${order}`);
            break;
        }
      }
      // Unconditional here: with two or more keys the order is either already a
      // full sort, or the default `length DESC, completeness DESC`, which
      // idx_bgcs_length_complete covers with id as its third column (same plan).
      if (BGC_SORTS_WITH_OWN_KEY.has(sortFields[sortFields.length - 1]!)) {
        orderParts.push('b.id ASC');
      }
      orderBy = Prisma.raw(`ORDER BY ${orderParts.join(', ')}`);
    }

    // The scope string carries the version; bump it when the row shape changes.
    const { dataKey, countKey } = buildListCacheKeys('bgcs:list:v3', params, [
      'limit', 'offset', 'sortField', 'sortOrder', 'sortFields', 'sortOrders',
    ]);

    const fetchTotal = async (): Promise<number> => {
      // Empty-filter fast path: exact sum from the tiny source_type_statistics MV.
      // Check filterTouches.bg too: the gcf filter is a JOIN predicate, not in `filters`.
      if (filters.length === 0 && !filterTouches.bg) {
        const r = await prisma.$queryRaw<{ count: bigint }[]>`
          SELECT COALESCE(SUM(bgc_count), 0)::bigint AS count FROM source_type_statistics
        `;
        return Number(r?.[0]?.count ?? 0);
      }

      // Sole product filter: precomputed count instead of a live GIN count.
      if (filters.length === 1 && soleProduct && !filterTouches.bg) {
        const c = (await getProductFacetCounts()).get(`${soleProduct.kind}:${soleProduct.value}`);
        if (c !== undefined) return c;
      }

      // Same shortcut for the sample-derived filters, where the COUNT is the expensive half.
      if (filters.length === 1 && soleGoldBucket && !filterTouches.bg) {
        const c = (await getGoldBucketCounts()).get(soleGoldBucket);
        if (c !== undefined) return c;
      }
      if (filters.length === 1 && soleDataSource && !filterTouches.bg) {
        const c = (await getDataSourceCounts()).get(soleDataSource);
        if (c !== undefined) return c;
      }

      // Filtered count: only the JOINs the active filters need (filterJoins).
      const totalResult = await withFallbackTimeout((tx) => tx.$queryRaw<{ count: bigint }[]>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM bgcs b
        ${joinsFor(filterJoins())}
        ${where}
      `));
      return Number(totalResult?.[0]?.count ?? 0);
    };

    // The joins the active filters need, for the count and the page query's inner
    // step. INNER lets the planner push the filter into the joined-table index scan
    // (LEFT costs ~17s on 11.7M rows), but is only sound per innerJoin (see
    // advancedFilterRequires).
    function filterJoins(): Prisma.Sql[] {
      const countJoins: Prisma.Sql[] = [];
      if (filterTouches.bbs) {
        countJoins.push(innerJoin.bbs
          ? Prisma.sql`INNER JOIN bgc_biome_summary_mv bbs ON bbs.bgc_id = b.id`
          : Prisma.sql`LEFT JOIN bgc_biome_summary_mv bbs ON bbs.bgc_id = b.id`);
      }
      if (filterTouches.t) {
        // Both hops use the same join kind: a LEFT anywhere blocks the pushdown.
        if (innerJoin.t) {
          countJoins.push(Prisma.sql`INNER JOIN bgc_taxonomy bt ON bt.bgc_id = b.id`);
          countJoins.push(Prisma.sql`INNER JOIN taxonomies t ON t.id = bt.taxonomy_id`);
        } else {
          countJoins.push(Prisma.sql`LEFT JOIN bgc_taxonomy bt ON bt.bgc_id = b.id`);
          countJoins.push(Prisma.sql`LEFT JOIN taxonomies t ON t.id = bt.taxonomy_id`);
        }
      }
      if (filterTouches.asm) {
        countJoins.push(innerJoin.asm
          ? Prisma.sql`INNER JOIN assembly_samples_mv asm ON asm.assembly_id = b.assembly`
          : Prisma.sql`LEFT JOIN assembly_samples_mv asm ON asm.assembly_id = b.assembly`);
      }
      if (filterTouches.bg) {
        countJoins.push(Prisma.sql`INNER JOIN bgc_gcf bg ON bg.bgc_id = b.id AND bg.is_primary ${gcfJoinCond}`);
      }
      return countJoins;
    }
    const joinsFor = (joins: Prisma.Sql[]) => (joins.length ? Prisma.join(joins, ' ') : Prisma.empty);

    const fetchData = async () => {
      type RawRow = {
        id: string;
        assembly: string;
        assembly_source_type: string;
        filename: string;
        product_category: string[] | null;
        product: string[] | null;
        is_complete: boolean;
        start_pos: number;
        end_pos: number;
        num_cds_features: number | null;
        gcf_id: string | null;
        gcf_name: string | null;
        distance: number | string | { toNumber?: () => number } | null;
        length: number | string;
        antismash_run_id: string | null;
        anchor: string | null;
        resolved_biome_level_1: string | null;
        resolved_biome_level_2: string | null;
        resolved_biome_level_3: string | null;
        resolved_biome_level_4: string | null;
        environment_biome: string | null;
        environment_feature: string | null;
        environment_material: string | null;
        sample_ids: string[] | null;
        sample_labels: string[] | null;
        data_source_names: string[] | null;
        gold_ecosystem_path: string | null;
        gold_ecosystem_metadata: Record<string, unknown> | null;
        taxonomy_domain: string | null;
        taxonomy_phylum: string | null;
        taxonomy_class: string | null;
        taxonomy_order: string | null;
        taxonomy_family: string | null;
        taxonomy_genus: string | null;
        taxonomy_species: string | null;
        gtdb_lineage: string | null;
      };

      // Two steps. The inner one finds the page -- filter, sort, LIMIT/OFFSET --
      // over bgcs and only the joins the filters and the sort need. The outer one
      // reads the page's columns from everything else, for those `limit` rows.
      //
      // In one step PostgreSQL could not take the LIMIT before the decorating
      // joins: it read biome, samples, data sources and taxonomy for every match
      // and then kept 50 (seconds of cold reads even for a small map box), and with
      // ten relations against join_collapse_limit 8 it often walked bgcs in ORDER BY
      // order instead. The inner step has few enough relations to plan freely.
      //
      // The outer ORDER BY repeats the inner one over the same rows (every join
      // here is at most one row per BGC), so the page keeps the inner order.
      const pageJoins = [...filterJoins()];
      if (!filterTouches.bg && sortFields.some((f) => f === 'gcf' || f === 'distance')) {
        pageJoins.push(Prisma.sql`LEFT JOIN bgc_gcf bg ON bg.bgc_id = b.id AND bg.is_primary`);
      }
      if (!filterTouches.bbs && sortFields.includes('biome')) {
        pageJoins.push(Prisma.sql`LEFT JOIN bgc_biome_summary_mv bbs ON bbs.bgc_id = b.id`);
      }
      if (!filterTouches.t && sortFields.includes('taxonomy')) {
        pageJoins.push(Prisma.sql`LEFT JOIN bgc_taxonomy bt ON bt.bgc_id = b.id`);
        pageJoins.push(Prisma.sql`LEFT JOIN taxonomies t ON t.id = bt.taxonomy_id`);
      }

      const rows = await withFallbackTimeout((tx) => tx.$queryRaw<RawRow[]>(Prisma.sql`
        SELECT
          b.id,
          b.assembly,
          a.source_type AS assembly_source_type,
          b.filename,
          b.product_category,
          b.product,
          b.is_complete,
          b.start_pos,
          b.end_pos,
          b.num_cds_features,
          bg.gcf_id,
          g.name AS gcf_name,
          bg.distance,
          (b.end_pos - b.start_pos) AS length,
          b.antismash_run_id,
          b.anchor,
          bbs.resolved_biome_level_1,
          bbs.resolved_biome_level_2,
          bbs.resolved_biome_level_3,
          bbs.resolved_biome_level_4,
          bbs.environment_biome,
          bbs.environment_feature,
          bbs.environment_material,
          asm.gold_ecosystem_path,
          asm.gold_ecosystem_metadata,
          COALESCE(
            (SELECT array_agg(asam.sample_id::text)
             FROM unnest(asm.sample_ids) AS asam(sample_id)),
            ARRAY[]::text[]
          ) AS sample_ids,
          COALESCE(asm.sample_labels, ARRAY[]::text[]) AS sample_labels,
          COALESCE(src.data_source_names, ARRAY[]::text[]) AS data_source_names,
          t.domain AS taxonomy_domain,
          t.phylum AS taxonomy_phylum,
          t.class AS taxonomy_class,
          t.order_name AS taxonomy_order,
          t.family AS taxonomy_family,
          t.genus AS taxonomy_genus,
          t.species AS taxonomy_species,
          t.gtdb_lineage
        FROM (
          SELECT b.id
          FROM bgcs b
          ${joinsFor(pageJoins)}
          ${where}
          ${orderBy}
          LIMIT ${limit} OFFSET ${offset}
        ) page
        JOIN bgcs b ON b.id = page.id
        LEFT JOIN assemblies a ON a.id = b.assembly
        ${filterTouches.bg
          ? Prisma.sql`INNER JOIN bgc_gcf bg ON bg.bgc_id = b.id AND bg.is_primary ${gcfJoinCond}`
          : Prisma.sql`LEFT JOIN bgc_gcf bg ON bg.bgc_id = b.id AND bg.is_primary`}
        LEFT JOIN gcfs g ON g.id = bg.gcf_id
        ${innerJoin.bbs
          ? Prisma.sql`INNER JOIN bgc_biome_summary_mv bbs ON bbs.bgc_id = b.id`
          : Prisma.sql`LEFT JOIN bgc_biome_summary_mv bbs ON bbs.bgc_id = b.id`}
        ${innerJoin.asm
          ? Prisma.sql`INNER JOIN assembly_samples_mv asm ON asm.assembly_id = b.assembly`
          : Prisma.sql`LEFT JOIN assembly_samples_mv asm ON asm.assembly_id = b.assembly`}
        LEFT JOIN LATERAL (
          SELECT array_agg(DISTINCT dn ORDER BY dn) AS data_source_names
          FROM sample_summary ss2
          CROSS JOIN LATERAL unnest(ss2.data_source_names) AS dn
          WHERE ss2.id = ANY(asm.sample_ids)
        ) src ON true
        ${innerJoin.t
          ? Prisma.sql`INNER JOIN bgc_taxonomy bt ON bt.bgc_id = b.id
                       INNER JOIN taxonomies t ON t.id = bt.taxonomy_id`
          : Prisma.sql`LEFT JOIN bgc_taxonomy bt ON bt.bgc_id = b.id
                       LEFT JOIN taxonomies t ON t.id = bt.taxonomy_id`}
        ${orderBy}
      `));

      const data = rows.map((r: RawRow) => {
        const product_category: string[] = Array.isArray(r.product_category) ? r.product_category : [];
        const product: string[] = Array.isArray(r.product) ? r.product : [];

        let category: string | null = null;
        let categories: string[] = [];
        if (product_category.length > 1) {
          category = 'Hybrid';
          categories = product_category;
        } else if (product_category.length === 1) {
          category = product_category[0];
          categories = product_category;
        }

        const distanceRaw = typeof r.distance === 'number'
          ? r.distance
          : (typeof r.distance === 'object' && r.distance !== null && 'toNumber' in r.distance
            ? (r.distance as { toNumber: () => number }).toNumber()
            : Number(r.distance));
        const distance = r.distance === null || r.distance === undefined || Number.isNaN(distanceRaw)
          ? null
          : distanceRaw;

        const length = typeof r.length === 'number' ? r.length : Number(r.length);

        // Flat-biome (metalog/SPIRE) samples repeat the same term at every level.
        const resolvedLevels = collapseConsecutiveLevels([
          r.resolved_biome_level_1,
          r.resolved_biome_level_2,
          r.resolved_biome_level_3,
          r.resolved_biome_level_4,
        ]);

        const environmentContext = [
          r.environment_biome,
          r.environment_feature,
          r.environment_material,
        ].filter((value): value is string => Boolean(value && value.trim()));

        // Prefer the raw ENVO biome term; the lineage just mirrors the GOLD path.
        const envBiome = (r.environment_biome ?? '').trim();
        const biomeLevels = envBiome ? [envBiome] : resolvedLevels;
        const biomeDisplay = biomeLevels.length > 0
          ? biomeLevels.join(' > ')
          : (environmentContext[0] ?? 'Unknown');

        return {
          id: r.id,
          assemblyDisplay: r.assembly,
          assembly: r.assembly,
          assemblySourceType: r.assembly_source_type,
          name: r.filename,
          category,
          categories,
          products: product,
          completeness: r.is_complete === true ? 'complete' : 'partial',
          length,
          genes: r.num_cds_features ?? null,
          gcf: r.gcf_id ?? null,
          gcfName: r.gcf_name ?? null,
          distance,
          antismashRunId: r.antismash_run_id ?? null,
          anchor: r.anchor ?? null,
          biome: biomeDisplay,
          biomeLevels,
          biomeEnvironment: environmentContext,
          goldEcosystemPath: r.gold_ecosystem_path ?? null,
          goldEcosystemMetadata: r.gold_ecosystem_metadata ?? null,
          sampleIds: Array.isArray(r.sample_ids) ? r.sample_ids : [],
          sampleLabels: stripSourcePrefixes(r.sample_labels),
          dataSourceNames: Array.isArray(r.data_source_names) ? r.data_source_names : [],
          taxonomyDomain: r.taxonomy_domain ?? null,
          taxonomyPhylum: r.taxonomy_phylum ?? null,
          taxonomyClass: r.taxonomy_class ?? null,
          taxonomyOrder: r.taxonomy_order ?? null,
          taxonomyFamily: r.taxonomy_family ?? null,
          taxonomyGenus: r.taxonomy_genus ?? null,
          taxonomySpecies: r.taxonomy_species ?? null,
          gtdbLineage: r.gtdb_lineage ?? null,
        };
      });

      return data;
    };

    const runPage = () => Promise.all([
      getOrSetCache(countKey, fetchTotal, 600),
      getOrSetCache(dataKey, fetchData, 60),
    ]);
    let page: Awaited<ReturnType<typeof runPage>>;
    try {
      page = await FALLBACK_GATE.run(runPage);
    } catch (error) {
      if (error instanceof GateBusyError) {
        console.warn(`[api/bgcs] SQL fallback busy (${FALLBACK_GATE.active} running, ${FALLBACK_GATE.waiting} waiting); answered 503`);
        return fallbackUnavailable(FALLBACK_BUSY_MESSAGE);
      }
      if (isStatementTimeout(error)) {
        console.warn(`[api/bgcs] SQL fallback query passed ${FALLBACK_STATEMENT_TIMEOUT}; answered 503 (${url.search})`);
        return fallbackUnavailable(FALLBACK_TIMEOUT_MESSAGE);
      }
      throw error;
    }
    const [total, data] = page;

    // An empty page past offset 0 on the unfiltered path: recount exactly (cached
    // for an hour) so the client can re-paginate to the true last page.
    let effectiveTotal = total;
    if (data.length === 0 && offset > 0 && filters.length === 0 && !filterTouches.bg) {
      effectiveTotal = await getOrSetCache(
        `${countKey}:exact`,
        async () => {
          const r = await prisma.$queryRaw<{ count: bigint }[]>`
            SELECT COUNT(*)::bigint AS count FROM bgcs
          `;
          return Number(r?.[0]?.count ?? 0);
        },
        3600,
      );
    }

    return NextResponse.json({
      success: true,
      // Enriched outside getOrSetCache so the cached payload shape is unchanged.
      data: { data: await withKnownClusterHits(data), total: effectiveTotal, limit, offset },
    });
  } catch (error: unknown) {
    const refusal = filterRefusalResponse(error);
    if (refusal) return refusal;
    // Log the exception, never echo it: Prisma messages carry SQL and bound values.
    return serverError(error, 'Error in /api/bgcs');
  }
}
