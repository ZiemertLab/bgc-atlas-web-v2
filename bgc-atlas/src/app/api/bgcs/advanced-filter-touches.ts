import type { FilterGroup, FilterValue } from '@/lib/filters/types';
import { hasFilterRules, isBlankFilterValue } from '@/lib/filters/types';

/**
 * The joined tables an advanced filter can reach, by `/api/bgcs`'s SQL aliases
 * for `bgc_biome_summary_mv`, `taxonomies` and `assembly_samples_mv`.
 */
export type BgcJoinAliases = { bbs: boolean; t: boolean; asm: boolean };

/** Keep in step with `buildBgcAdvancedCondition`; the test compiles every field to check. */
const aliasForField = (field: string): keyof BgcJoinAliases | null => {
  if (field === 'biome') return 'bbs';
  if (field === 'taxonomy') return 't';
  if (field === 'goldEcosystem') return 'asm';
  return null;
};

/**
 * A blank condition is dropped by `buildAdvancedWhere`, so it must count as
 * neither conjunct nor disjunct here (else it would force LEFT on an OR). Shares
 * `isBlankFilterValue` with that guard and `hasFilterRules` so all three agree.
 */
const isVisible = (value: FilterValue) => !isBlankFilterValue(value);

/**
 * True when every row the filter can match is guaranteed a row in the joined
 * table, i.e. INNER JOIN is sound. AND -> any effective child requires it;
 * OR -> every one does. Non-'OR' operators are treated as AND, as
 * `buildAdvancedWhere` does.
 */
const requiresAlias = (node: FilterGroup, alias: keyof BgcJoinAliases): boolean => {
  const children: boolean[] = [
    ...node.conditions
      .filter((condition) => isVisible(condition.value))
      .map((condition) => aliasForField(condition.field) === alias),
    ...node.groups
      .filter(hasFilterRules)
      .map((child) => requiresAlias(child, alias)),
  ];
  if (!children.length) return false;
  return node.operator === 'OR' ? children.every(Boolean) : children.some(Boolean);
};

const referencesAlias = (node: FilterGroup, alias: keyof BgcJoinAliases): boolean =>
  node.conditions.some(
    (condition) => isVisible(condition.value) && aliasForField(condition.field) === alias,
  )
  || node.groups.some((child) => referencesAlias(child, alias));

/**
 * Which joins the query must carry at all. Forcing all three on whenever
 * advancedFilters is present makes `length >= 10000` take ~145s (past the 120s
 * timeout) vs ~15s, so a join is added only when a condition names it.
 */
export const advancedFilterTouches = (group: FilterGroup | null): BgcJoinAliases => {
  if (!group) return { bbs: false, t: false, asm: false };
  return {
    bbs: referencesAlias(group, 'bbs'),
    t: referencesAlias(group, 't'),
    asm: referencesAlias(group, 'asm'),
  };
};

/**
 * Which of those joins may be INNER. INNER allows the filter pushdown (LEFT
 * costs ~17s on 11.7M rows), but is only sound when the filter cannot match a
 * BGC with no row in the joined table: some BGCs lack a biome, taxonomy or
 * assembly_samples_mv row. Under `(length >= 10000) OR (biome contains soil)`,
 * INNER would silently drop length-only matches at HTTP 200, so OR gets LEFT
 * even at the cost of a possible timeout.
 */
export const advancedFilterRequires = (group: FilterGroup | null): BgcJoinAliases => {
  if (!group) return { bbs: false, t: false, asm: false };
  return {
    bbs: requiresAlias(group, 'bbs'),
    t: requiresAlias(group, 't'),
    asm: requiresAlias(group, 'asm'),
  };
};
