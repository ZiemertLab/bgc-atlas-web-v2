// Shared by /api/studies and its streamed export so the two agree on matches and order.
import { Prisma } from '@prisma/client';

import prisma from '@/lib/prisma';
import { abstractState } from '@/lib/abstract-license';
import { studyFilterFields } from '@/lib/filters/field-definitions';
import {
  buildAdvancedWhere,
  buildMultiColumnTextCondition,
  buildNumberCondition,
  buildSelectCondition,
  buildTextCondition,
  extractMultipleValues,
} from '@/lib/filters/prisma-builders';
import { parseAdvancedFilterParam, type FilterCondition } from '@/lib/filters/types';

// Reads the precomputed study_bgc_summary table (scripts/populator/tools/study_bgc_summary/build.py).


// Umbrella BioProjects that sweep up unrelated genomes and distort the ranking. Hidden from the
// index only; the detail route still resolves them.
export const EXCLUDED_STUDY_KEYS = [
  'PRJNA224116', // RefSeq Prokaryotic Genome Annotation Project
  'PRJNA230969', // GenomeTrakr Project, US Food and Drug Administration
  'PRJNA231221', // FDA-ARGOS reference genome database
];

// Raw {ecosystem: sample_count} maps from study_ecosystem_dist.
type EcosystemCounts = Record<string, number> | null;
type StudyRow = Record<string, unknown> & {
  eco_l1: EcosystemCounts;
  eco_l2: EcosystemCounts;
  eco_l3: EcosystemCounts;
  /** From the abstract join below; both null when no sibling row has either. */
  has_abstract: boolean | null;
  abstract_withheld: boolean | null;
};

// The charts take shares on a [0, 100] domain. Each GOLD level is normalised against its own
// total: a sample can stop at level 1, so levels have different denominators.
function toPercentagesByLevel(
  byLevel: Record<number, EcosystemCounts>
): Record<number, Record<string, number>> | null {
  const out: Record<number, Record<string, number>> = {};
  let any = false;

  for (const [level, counts] of Object.entries(byLevel)) {
    const entries = Object.entries(counts ?? {}).filter(([, n]) => n > 0);
    const total = entries.reduce((sum, [, n]) => sum + n, 0);
    if (!total) {
      out[Number(level)] = {};
      continue;
    }
    any = true;
    out[Number(level)] = Object.fromEntries(
      entries.map(([ecosystem, n]) => [ecosystem, (n / total) * 100])
    );
  }

  return any ? out : null;
}

export function parseIntParam(value: string | null, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

// Column ids here match the ResizableTable column ids on the /studies page.
const sortFieldMap: Record<string, Prisma.Sql> = {
  exclusive: Prisma.sql`exclusive_gcfs`,
  rare: Prisma.sql`rare_gcfs`,
  distinct: Prisma.sql`distinct_gcfs`,
  total: Prisma.sql`total_bgcs`,
  complete: Prisma.sql`complete_bgcs`,
  genomes: Prisma.sql`genome_count`,
  coverage: Prisma.sql`gcf_coverage`,
  products: Prisma.sql`product_type_count`,
  samples: Prisma.sql`sample_count`,
  title: Prisma.sql`COALESCE(title, study_name)`,
};

const toLike = (value: string) => `%${value}%`;

// product_category_dist is jsonb {category: bgc_count}, so membership is a key test.
function buildProductCategoryCondition(condition: FilterCondition): Prisma.Sql | null {
  const values = extractMultipleValues(condition.value);
  if (!values.length) return null;

  // jsonb_exists_any(), not `?|`: `?` is a placeholder token in raw queries.
  const negated = condition.operator === 'not_equals' || condition.operator === 'not_in';
  const present = Prisma.sql`jsonb_exists_any(product_category_dist, ${values}::text[])`;
  return negated ? Prisma.sql`NOT COALESCE(${present}, FALSE)` : present;
}

const buildStudyAdvancedCondition = (condition: FilterCondition): Prisma.Sql | null => {
  switch (condition.field) {
    // One "Title" field over study_name (always present) and title.
    case 'title':
      return buildMultiColumnTextCondition(
        [Prisma.sql`title`, Prisma.sql`study_name`],
        condition,
        toLike
      );
    case 'bioproject':
      return buildTextCondition(Prisma.sql`bioproject`, condition, toLike);
    case 'accession':
      return buildTextCondition(Prisma.sql`accession`, condition, toLike);
    case 'goldBucket':
      return buildSelectCondition(Prisma.sql`gold_bucket`, condition);
    case 'productCategory':
      return buildProductCategoryCondition(condition);
    case 'exclusiveGcfs':
      return buildNumberCondition(Prisma.sql`exclusive_gcfs`, condition);
    case 'rareGcfs':
      return buildNumberCondition(Prisma.sql`rare_gcfs`, condition);
    case 'distinctGcfs':
      return buildNumberCondition(Prisma.sql`distinct_gcfs`, condition);
    case 'totalBgcs':
      return buildNumberCondition(Prisma.sql`total_bgcs`, condition);
    case 'clusteredBgcs':
      return buildNumberCondition(Prisma.sql`clustered_bgcs`, condition);
    // Stored 0..1; the field is labelled "(%)" so the user's 0..100 is scaled down.
    case 'gcfCoverage':
      return buildNumberCondition(Prisma.sql`gcf_coverage`, condition, { scale: 100 });
    // Already stored 0..100 — no scaling.
    case 'pctComplete':
      return buildNumberCondition(Prisma.sql`pct_complete`, condition);
    case 'productTypeCount':
      return buildNumberCondition(Prisma.sql`product_type_count`, condition);
    case 'sampleCount':
      return buildNumberCondition(Prisma.sql`sample_count`, condition);
    case 'completeBgcs':
      return buildNumberCondition(Prisma.sql`complete_bgcs`, condition);
    case 'genomeCount':
      return buildNumberCondition(Prisma.sql`genome_count`, condition);
    default:
      return null;
  }
};

export function buildStudyOrder(params: URLSearchParams) {
  const sortField = params.get('sortField') ?? 'exclusive';
  const direction = params.get('sortOrder') === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  // hasOwn: a plain object also answers `constructor`, `__proto__` and friends.
  const column = Object.hasOwn(sortFieldMap, sortField) ? sortFieldMap[sortField] : sortFieldMap.exclusive;
  // study_key tiebreak keeps pagination stable across equal metric values.
  return Prisma.sql`ORDER BY ${column} ${direction} NULLS LAST, study_key ASC`;
}

/** The listing's WHERE. Throws a refusal for an advanced filter it cannot honour. */
export function buildStudyWhere(params: URLSearchParams): Prisma.Sql {
  // ?key= resolves one study by exact study_key (a lookup, so the index exclusions don't apply).
  const key = (params.get('key') ?? '').trim();

  const filters: Prisma.Sql[] = key ? [Prisma.sql`study_key = ${key}`] : [
    Prisma.sql`study_key <> ALL(${EXCLUDED_STUDY_KEYS})`,
    // Index-only exclusions of rows that would render as zeros; the detail route still resolves them.
    Prisma.sql`sample_count > 0`,
    Prisma.sql`total_bgcs > 0`,
  ];

  const search = (params.get('search') ?? '').trim();
  if (search) {
    const like = `%${search}%`;
    filters.push(Prisma.sql`(
      title ILIKE ${like} OR study_name ILIKE ${like} OR center_name ILIKE ${like}
      OR accession ILIKE ${like} OR bioproject ILIKE ${like}
    )`);
  }

  const goldBucket = (params.get('goldBucket') ?? '').trim();
  if (goldBucket) filters.push(Prisma.sql`gold_bucket = ${goldBucket}`);

  const biome = (params.get('biome') ?? '').trim();
  if (biome) filters.push(Prisma.sql`primary_biome = ${biome}`);

  const minBgcs = parseIntParam(params.get('minBgcs'), 0, 0);
  if (minBgcs > 0) filters.push(Prisma.sql`total_bgcs >= ${minBgcs}`);

  const minExclusive = parseIntParam(params.get('minExclusive'), 0, 0);
  if (minExclusive > 0) filters.push(Prisma.sql`exclusive_gcfs >= ${minExclusive}`);

  // Refuses rather than widens; callers turn the throw into a 400 via filterRefusalResponse.
  const advancedWhere = buildAdvancedWhere(
    parseAdvancedFilterParam(params.get('advancedFilters')),
    buildStudyAdvancedCondition,
    studyFilterFields,
  );
  if (advancedWhere) filters.push(advancedWhere);
  return filters.length
    ? Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}`
    : Prisma.empty;
}

  // BIGINT counters -> ::int so NextResponse.json doesn't choke on BigInt (all fit int).
const selectCols = Prisma.sql`
    study_key, study_id, title, study_name, center_name, accession, bioproject, study_type,
    sample_count,
    total_bgcs::int      AS total_bgcs,
    clustered_bgcs::int  AS clustered_bgcs,
    gcf_coverage,
    distinct_gcfs::int   AS distinct_gcfs,
    exclusive_gcfs::int  AS exclusive_gcfs,
    rare_gcfs::int       AS rare_gcfs,
    pct_complete,
    product_type_count,
    product_category_dist,
    top_exclusive_gcfs,
    primary_biome,
    gold_bucket,
    complete_bgcs::int   AS complete_bgcs,
    genome_count,
    source_type_dist,
    data_sources`;


export async function countStudies(whereClause: Prisma.Sql): Promise<number> {
  const rows = await prisma.$queryRaw<{ total: number }[]>(Prisma.sql`
    SELECT COUNT(*)::int AS total FROM study_bgc_summary ${whereClause}
  `);
  return rows?.[0]?.total ?? 0;
}

export async function fetchStudyRows(
  whereClause: Prisma.Sql, orderClause: Prisma.Sql, limit: number, offset: number,
) {
    // study_ecosystem_dist is joined onto the already-limited page so the join is `limit` index
    // probes. `abs` is restricted to rows holding or withholding an abstract; others are `absent`.
    const rows = await prisma.$queryRaw<StudyRow[]>(Prisma.sql`
      SELECT page.*, sed.l1 AS eco_l1, sed.l2 AS eco_l2, sed.l3 AS eco_l3,
             abs.has_abstract, abs.abstract_withheld
      FROM (
        SELECT ${selectCols}
        FROM study_bgc_summary
        ${whereClause}
        ${orderClause}
        LIMIT ${limit}
        OFFSET ${offset}
      ) page
      LEFT JOIN study_ecosystem_dist sed ON sed.study_key = page.study_key
      LEFT JOIN (
        SELECT COALESCE(NULLIF(study_name, ''), accession, id::text) AS study_key,
               bool_or(abstract IS NOT NULL) AS has_abstract,
               bool_or(abstract_withheld) AS abstract_withheld
        FROM studies
        WHERE abstract IS NOT NULL OR abstract_withheld
        GROUP BY 1
      ) abs ON abs.study_key = page.study_key
      ${orderClause}
    `);

    return rows.map(({ eco_l1, eco_l2, eco_l3, has_abstract, abstract_withheld, ...study }) => ({
      ...study,
      ecosystem_dist_by_level: toPercentagesByLevel({ 1: eco_l1, 2: eco_l2, 3: eco_l3 }),
      // State only; attribution fields live on /api/studies/{id}.
      abstract_state: abstractState({
        hasAbstract: !!has_abstract,
        withheld: !!abstract_withheld,
      }),
    }));
  }
