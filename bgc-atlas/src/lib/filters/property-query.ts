// The Property Search builder's rows, turned into the question the search asks.
// Kept out of the component so the edge cases -- which member set counts, when a
// family question becomes a plain filter -- can be tested directly.

import type { FamilyScope } from '@/lib/filters/family-scope-url';
import { groupToRows, rowsExpression, rowsHaveRules, rowsToGroup, type FilterRow } from '@/lib/filters/rows';
import {
  createDefaultFilterGroup, hasFilterRules, type FilterCondition, type FilterGroup,
} from '@/lib/filters/types';

export type PropertyEntity = 'bgcs' | 'gcfs' | 'samples';

export interface PropertyQuery {
  group: FilterGroup | null;
  scope: FamilyScope | null;
}

/**
 * What the rows ask, in the shape the search takes. Families with two or more
 * member sets are a family-scope question (each set is matched by at least one
 * member); otherwise the one set that has rules is a plain filter.
 *
 * "The one set that has rules", not the first set: a Families search whose only
 * filled set was the second used to read the empty first set, send no filter at
 * all, and list every family while the summary said "at least one member: ...".
 */
export function queryOf(
  entity: PropertyEntity,
  sets: FilterRow[][],
  labels: string[],
  minPurity: number,
  describe: (c: FilterCondition) => string,
): PropertyQuery {
  const live = sets.filter(rowsHaveRules);
  if (entity === 'gcfs' && live.length >= 2) {
    const kept = sets.map((rows, i) => ({ rows, label: labels[i] ?? '' })).filter((x) => rowsHaveRules(x.rows));
    return {
      group: null,
      scope: {
        cohorts: kept.map((x) => rowsToGroup(x.rows)),
        // A results column per set, headed by what the set asks unless an old link named it.
        labels: kept.map((x) => x.label.trim() || rowsExpression(x.rows, describe).map((p) => p.value).join(' ')),
        minPurity,
      },
    };
  }
  return { group: live.length ? rowsToGroup(live[0]) : null, scope: null };
}

/** An old ?fam link: its base filter applied to every member, so it goes into each set. */
export const setsFromScope = (base: FilterGroup | null, scope: FamilyScope): FilterRow[][] =>
  scope.cohorts.map((cohort) => groupToRows(base && hasFilterRules(base)
    ? { ...createDefaultFilterGroup(), groups: [base, cohort] }
    : cohort));
