/**
 * The `advancedFilters` condition resolver for /api/bgcs. Lives outside
 * route.ts because a route module may only export route fields (only
 * `next build` catches that), and the tests import it.
 */
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import {
  buildMultiColumnTextCondition,
  buildNumberCondition,
  buildTextCondition,
  extractStringValue,
} from '@/lib/filters/prisma-builders';
import { type FilterCondition } from '@/lib/filters/types';

export const toLike = (value: string) => `%${value.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;

export const isValidUuid = (id: string) => {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
};

// Above this many assemblies the sample filter reverts to a correlated EXISTS,
// which sorts the whole ~16.5M-row corpus (120 s timeout). The largest sample
// has ~2,000 assemblies.
const SAMPLE_ASSEMBLY_INLINE_CAP = 3000;

/**
 * Turn "the samples matching X" into a filter on `bgcs`.
 *
 * Resolves the assemblies in a separate round trip and inlines them: every
 * correlated form leaves the planner no cardinality estimate for b.assembly,
 * so it sorts all ~16.5M rows and hits the 120s timeout.
 *
 * `sampleWhere` is a predicate over `sample_assemblies sa JOIN samples s`.
 * Returns `false` when nothing matches; above the inline cap it falls back to
 * the correlated form.
 */
export async function assemblyFilterForSamples(sampleWhere: Prisma.Sql): Promise<Prisma.Sql> {
  const rows = await prisma.$queryRaw<{ assembly_id: string }[]>(Prisma.sql`
    SELECT DISTINCT sa.assembly_id::text AS assembly_id
    FROM sample_assemblies sa
    JOIN samples s ON s.id = sa.sample_id
    WHERE ${sampleWhere}
    LIMIT ${SAMPLE_ASSEMBLY_INLINE_CAP + 1}
  `);
  if (rows.length > SAMPLE_ASSEMBLY_INLINE_CAP) {
    return Prisma.sql`
      EXISTS (
        SELECT 1
        FROM sample_assemblies sa
        JOIN samples s ON s.id = sa.sample_id
        WHERE sa.assembly_id = b.assembly AND ${sampleWhere}
      )
    `;
  }
  if (!rows.length) return Prisma.sql`false`;
  return Prisma.sql`b.assembly IN (${Prisma.join(
    rows.map((r) => Prisma.sql`${r.assembly_id}::uuid`)
  )})`;
}

export const buildBgcAdvancedCondition = async (condition: FilterCondition): Promise<Prisma.Sql | null> => {
  switch (condition.field) {
    case 'id':
      return buildTextCondition(Prisma.sql`b.id::text`, condition, toLike);
    case 'assembly':
      return buildTextCondition(Prisma.sql`b.assembly::text`, condition, toLike);
    case 'sampleId':
      return buildSampleIdCondition(condition);
    case 'sample':
      return buildSampleTextCondition(condition);
    case 'gcf':
      return buildGcfIdCondition(condition);
    case 'productCategory':
      return buildArrayCondition(condition, 'category');
    case 'productType':
      return buildArrayCondition(condition, 'type');
    case 'completeness':
      return buildCompletenessCondition(condition);
    case 'biome':
      return buildMultiColumnTextCondition([
        Prisma.sql`bbs.resolved_biome_level_1`,
        Prisma.sql`bbs.resolved_biome_level_2`,
        Prisma.sql`bbs.resolved_biome_level_3`,
        Prisma.sql`bbs.resolved_biome_level_4`,
        Prisma.sql`bbs.environment_biome`,
        Prisma.sql`bbs.environment_feature`,
        Prisma.sql`bbs.environment_material`,
      ], condition, toLike);
    // Same column as `?goldEcosystem=` and bgc_browse. Single-column (unlike
    // `biome`) so a negation is whole-value and the index can serve it.
    case 'goldEcosystem':
      return buildTextCondition(Prisma.sql`asm.gold_ecosystem_path`, condition, toLike);
    case 'taxonomy':
      return buildMultiColumnTextCondition([
        Prisma.sql`t.domain`,
        Prisma.sql`t.phylum`,
        Prisma.sql`t.class`,
        Prisma.sql`t.order_name`,
        Prisma.sql`t.family`,
        Prisma.sql`t.genus`,
        Prisma.sql`t.species`,
        Prisma.sql`t.gtdb_lineage`,
      ], condition, toLike);
    case 'length':
      return buildNumberCondition(Prisma.sql`(b.end_pos - b.start_pos)`, condition);
    case 'genes':
      return buildNumberCondition(Prisma.sql`b.num_cds_features`, condition);
    case 'distance':
      return buildDistanceCondition(condition);
    default:
      return null;
  }
};

// Self-contained EXISTS so it composes into the join-free COUNT query.
const buildGcfIdCondition = (condition: FilterCondition): Prisma.Sql | null => {
  const comparison = buildTextCondition(Prisma.sql`bgf.gcf_id::text`, condition, toLike);
  if (!comparison) return null;
  return Prisma.sql`
    EXISTS (
      SELECT 1 FROM bgc_gcf bgf
      WHERE bgf.bgc_id = b.id AND bgf.is_primary AND ${comparison}
    )
  `;
};

// Raw distance (lower = better), no 0..100 scaling.
const buildDistanceCondition = (condition: FilterCondition): Prisma.Sql | null => {
  const comparison = buildNumberCondition(Prisma.sql`bgf.distance`, condition);
  if (!comparison) return null;
  return Prisma.sql`
    EXISTS (
      SELECT 1 FROM bgc_gcf bgf
      WHERE bgf.bgc_id = b.id AND bgf.is_primary AND ${comparison}
    )
  `;
};

const buildSampleIdCondition = async (condition: FilterCondition): Promise<Prisma.Sql | null> => {
  const value = extractStringValue(condition.value);
  if (!value) return null;
  if (condition.operator === 'equals' && isValidUuid(value)) {
    return assemblyFilterForSamples(Prisma.sql`sa.sample_id = ${value}::uuid`);
  }
  const comparison = buildTextCondition(Prisma.sql`sa.sample_id::text`, condition, toLike);
  if (!comparison) return null;
  return assemblyFilterForSamples(comparison);
};

const buildSampleTextCondition = async (condition: FilterCondition): Promise<Prisma.Sql | null> => {
  const comparison = buildMultiColumnTextCondition([
    Prisma.sql`s.external_id`,
    Prisma.sql`s.name`,
  ], condition, toLike);
  if (!comparison) return null;
  return assemblyFilterForSamples(comparison);
};

const buildArrayCondition = (condition: FilterCondition, type: 'category' | 'type'): Prisma.Sql | null => {
  const alias = Prisma.raw(type === 'category' ? 'pc' : 'pt');
  const column = Prisma.raw(type === 'category' ? 'b.product_category' : 'b.product');
  const comparison = buildTextCondition(Prisma.sql`${alias}`, condition, toLike);
  if (!comparison) return null;
  return Prisma.sql`
    EXISTS (
      SELECT 1
      FROM unnest(${column}) AS ${alias}
      WHERE ${comparison}
    )
  `;
};

const buildCompletenessCondition = (condition: FilterCondition): Prisma.Sql | null => {
  const value = extractStringValue(condition.value).toLowerCase();
  if (!value) return null;
  if (value === 'complete') {
    return condition.operator === 'not_equals'
      ? Prisma.sql`b.is_complete = false`
      : Prisma.sql`b.is_complete = true`;
  }
  if (value === 'partial') {
    return condition.operator === 'not_equals'
      ? Prisma.sql`b.is_complete = true`
      : Prisma.sql`b.is_complete = false`;
  }
  return null;
};
