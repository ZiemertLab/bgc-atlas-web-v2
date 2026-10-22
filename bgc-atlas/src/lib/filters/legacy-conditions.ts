// Rewrites retired filter conditions into the ones that replaced them, so a saved
// or shared link keeps returning what it returned.
//
// Runs inside deserializeFilterGroup (every page and every route reads a link
// through it) and on a saved filter loaded from localStorage. It is
// DETERMINISTIC and IDEMPOTENT -- no new ids, and a migrated group passes through
// unchanged -- so a page's URL mirror writes the new form once and is stable
// after that.
//
// Type-only imports from ./types: types.ts imports this module at runtime.
import type { FilterCondition, FilterGroup, FilterOperator } from '@/lib/filters/types';
import { GCF_PRODUCT_TYPES } from '@/lib/gcf/product-types';
import {
  DEFAULT_SHARE_THRESHOLD,
  PRODUCT_SHARE_FIELD,
  isShareField,
} from '@/lib/filters/share-fields';

/** The retired GCF "Product" text field (any member, matched by text). */
export const LEGACY_PRODUCT_FIELD = 'productClass';

const NEGATIVE_OF: Partial<Record<FilterOperator, FilterOperator>> = {
  not_equals: 'equals',
  not_contains: 'contains',
  not_in: 'in',
};

const MATCHERS: Partial<Record<FilterOperator, (type: string, value: string) => boolean>> = {
  equals: (type, value) => type === value,
  in: (type, value) => type === value,
  contains: (type, value) => type.includes(value),
  starts_with: (type, value) => type.startsWith(value),
  ends_with: (type, value) => type.endsWith(value),
};

const textValues = (condition: FilterCondition, positive: FilterOperator): string[] => {
  const raw = Array.isArray(condition.value) ? condition.value : [condition.value];
  const values = raw
    .map((entry) => (entry === null || entry === undefined ? '' : String(entry).trim()))
    .filter(Boolean);
  // The old text resolvers read ONE value (extractStringValue: the first); only
  // `in` -- which the index served for API callers -- read them all.
  return positive === 'in' ? values : values.slice(0, 1);
};

/**
 * `productClass <op> text` -> `productShare` at threshold 0 ("any member").
 *
 * The old field matched case-insensitively, by text, against every primary
 * member's product (ILIKE in SQL, a case-insensitive wildcard on product_terms in
 * the index). Against a closed vocabulary that is the same as "any member carries
 * one of the types the text matches", so the text is expanded into those types:
 * `contains lanthi` becomes `is any of` the five lanthipeptide classes,
 * `equals nrps` becomes `is NRPS`. Negatives become the negation of that set.
 *
 * `*` and `?` are taken literally. The old index path read them as wildcards
 * inside its `contains`; the old SQL path (ILIKE, % and _ escaped) did not, and
 * no product type contains either character, so literal is the faithful reading.
 *
 * Text that matches no type is kept verbatim. It matched no family before (every
 * value a family carries is in the vocabulary) and as an exact term it matches
 * none now; the negative matched every family with a product, and still does.
 *
 * An operator the field never answered (gt, between...) is left alone: the
 * condition still names the retired field, and both backends refuse it.
 */
const migrateProductClass = (condition: FilterCondition): FilterCondition => {
  const negative = NEGATIVE_OF[condition.operator];
  const positive = negative ?? condition.operator;
  const matches = MATCHERS[positive];
  if (!matches) return condition;

  const wanted = textValues(condition, positive);
  const lowered = wanted.map((value) => value.toLowerCase());
  const types = GCF_PRODUCT_TYPES.filter((type) =>
    lowered.some((value) => matches(type.toLowerCase(), value)));
  const values = types.length ? types : wanted;

  const many = values.length > 1;
  const operator: FilterOperator = negative
    ? (many ? 'not_in' : 'not_equals')
    : (many ? 'in' : 'equals');
  return {
    id: condition.id,
    field: PRODUCT_SHARE_FIELD,
    operator,
    value: many ? values : (values[0] ?? ''),
    threshold: 0,
  };
};

const migrateCondition = (condition: FilterCondition): FilterCondition => {
  // The payload is unvalidated JSON; leave anything that is not a condition for
  // the backends to refuse.
  if (!condition || typeof condition !== 'object') return condition;
  if (condition.field === LEGACY_PRODUCT_FIELD) return migrateProductClass(condition);
  // A share condition without a threshold (an API client, or a hand-edited link)
  // means the default; writing it down gives both spellings one canonical form
  // (and the URL mirror then stores the explicit one).
  if (isShareField(condition.field) && condition.threshold === undefined) {
    return { ...condition, threshold: DEFAULT_SHARE_THRESHOLD };
  }
  return condition;
};

export const migrateLegacyFilterGroup = (group: FilterGroup): FilterGroup => ({
  ...group,
  conditions: group.conditions.map(migrateCondition),
  groups: group.groups.map(migrateLegacyFilterGroup),
});
