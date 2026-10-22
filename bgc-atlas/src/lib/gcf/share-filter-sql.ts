import { Prisma } from '@prisma/client';
import type { FilterCondition } from '@/lib/filters/types';
import { resolveShareCondition, type ShareQuery } from '@/lib/filters/share-fields';

/**
 * The /api/gcfs SQL fallback's form of a share condition (lib/filters/share-fields.ts
 * decides what one means; shareOsClause is the index's form of the same query).
 *
 *   threshold 10/50/90   gdm.<column> && ARRAY[...]   (GIN)
 *   product threshold 0  jsonb_exists_any(gdm.product_type_member_share, ARRAY[...])
 *                        -- its keys are exactly gcf_browse.product_terms, and it
 *                        avoids the per-member bgcs scan the old any-member EXISTS
 *                        did (that one timed out for negatives).
 *   ecosystem threshold 0  jsonb_exists_any(gdm.biome_distribution_l<n>, ARRAY[...])
 *                        -- the keys gcf_browse.eco_l<n>_any was built from. No
 *                        GIN on the jsonb: the planner seq-scans the view in
 *                        parallel and hash-joins (Marine at L3: 0.49 s for the
 *                        count, 2026-10-22), like the product form.
 *
 * A self-contained EXISTS on gcf_distributions_mv, keyed 1:1 on gcf_id, so it
 * composes into fetchTotal's join-free COUNT like every other gdm condition. The
 * negative carries the same `present` guard the index's must_not does.
 */
export const shareSqlPredicate = (query: ShareQuery): Prisma.Sql => {
  const values = Prisma.sql`ARRAY[${Prisma.join(query.values)}]::text[]`;
  const anyMemberKeys = query.threshold !== 0 ? null
    : query.spec.kind === 'product' ? 'product_type_member_share'
      : `biome_distribution_l${query.spec.level}`;
  const positive = anyMemberKeys
    ? Prisma.sql`jsonb_exists_any(gdm.${Prisma.raw(anyMemberKeys)}, ${values})`
    // The column name is built from a whitelisted threshold and level in
    // resolveShareCondition, never from client text.
    : Prisma.sql`gdm.${Prisma.raw(query.column)} && ${values}`;
  const test = query.negated
    ? Prisma.sql`${sharePresentSql(query)} AND NOT (${positive})`
    : positive;
  return Prisma.sql`EXISTS (
    SELECT 1 FROM gcf_distributions_mv gdm WHERE gdm.gcf_id = g.gcf_id AND ${test}
  )`;
};

/** The families a share is defined for: the SQL twin of shareOsClause's guard. */
const sharePresentSql = (query: ShareQuery): Prisma.Sql => (query.spec.kind === 'product'
  ? Prisma.sql`gdm.product_type_member_share <> '{}'::jsonb`
  : Prisma.sql`gdm.${Prisma.raw(`resolved_pct_l${query.spec.level}`)} > 0`);

/** buildGcfAdvancedCondition's entry point: null refuses (unusable value). */
export const buildShareCondition = (condition: FilterCondition): Prisma.Sql | null => {
  const query = resolveShareCondition(condition);
  return query ? shareSqlPredicate(query) : null;
};
