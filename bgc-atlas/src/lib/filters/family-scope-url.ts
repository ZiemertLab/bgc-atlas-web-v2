// URL codec for the Property Search family-scope settings: without the cohorts and purity floor a
// shared link reopens as a different, much larger answer.
import type { FilterGroup } from '@/lib/filters/types';
import { decodeBase64, encodeBase64, hasFilterRules } from '@/lib/filters/types';

export interface FamilyScope {
  cohorts: FilterGroup[];
  /** Display name per cohort, parallel to `cohorts`. */
  labels: string[];
  /** Fraction of a family's located members that must sit inside the cohorts, 0..1. */
  minPurity: number;
}

/** True when the scope would actually constrain anything: two cohorts with rules. */
export const isActiveFamilyScope = (scope: FamilyScope | null): scope is FamilyScope =>
  !!scope && scope.cohorts.filter((c) => hasFilterRules(c)).length >= 2;

export const serializeFamilyScope = (scope: FamilyScope | null): string => {
  if (!isActiveFamilyScope(scope)) return '';
  try {
    const keep = scope.cohorts
      .map((cohort, i) => ({ cohort, label: scope.labels[i] ?? '' }))
      .filter((c) => hasFilterRules(c.cohort));
    return encodeURIComponent(encodeBase64(JSON.stringify({
      cohorts: keep.map((c) => c.cohort),
      labels: keep.map((c) => c.label),
      minPurity: scope.minPurity,
    })));
  } catch {
    return '';
  }
};

export const deserializeFamilyScope = (encoded: string | null): FamilyScope | null => {
  if (!encoded) return null;
  try {
    const parsed = JSON.parse(decodeBase64(decodeURIComponent(encoded))) as Partial<FamilyScope>;
    if (!Array.isArray(parsed.cohorts)) return null;
    const minPurity = typeof parsed.minPurity === 'number' && Number.isFinite(parsed.minPurity)
      ? Math.min(1, Math.max(0, parsed.minPurity))
      : 1;
    const cohorts = parsed.cohorts as FilterGroup[];
    const labels = Array.isArray(parsed.labels)
      ? cohorts.map((_, i) => String(parsed.labels?.[i] ?? ''))
      : cohorts.map(() => '');
    const scope = { cohorts, labels, minPurity };
    return isActiveFamilyScope(scope) ? scope : null;
  } catch {
    return null;
  }
};
