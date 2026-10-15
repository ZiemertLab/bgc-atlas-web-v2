/**
 * Product categories as shares of a family's members. bgcs.product_category is
 * multi-label, so per-category counts overlap: product_category_distribution is a
 * partition over exact combinations ('NRPS+PKS') and may be stacked;
 * category_share_<cat> (% of members carrying it) overlaps and is never stacked.
 */

/** Allowed bgcs.product_category values, in the order the database spells combination keys. */
export const PRODUCT_CATEGORY_VALUES = [
  'NRPS', 'PKS', 'RiPP', 'terpene', 'saccharide', 'other',
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORY_VALUES)[number];

export const COMBINATION_SEPARATOR = '+';

/** 0 is "any member". */
export const CATEGORY_SHARE_THRESHOLDS = [0, 10, 50, 90] as const;

export const DEFAULT_CATEGORY_MIN_SHARE = 50;

export function canonicalCategory(value: string): ProductCategory | null {
  const lower = value.trim().toLowerCase();
  return PRODUCT_CATEGORY_VALUES.find((c) => c.toLowerCase() === lower) ?? null;
}

/** The gcf_browse field holding a category's share of members, 0-100. */
export const categoryShareField = (category: ProductCategory): string =>
  `category_share_${category.toLowerCase()}`;

/**
 * Null for a single category or a key that is not all known categories:
 * ProductCategoryChart also draws granular product names, which may contain '+'.
 */
export function splitCombination(key: string): ProductCategory[] | null {
  if (!key.includes(COMBINATION_SEPARATOR)) return null;
  const parts = key.split(COMBINATION_SEPARATOR).map(canonicalCategory);
  if (parts.length < 2 || parts.some((p) => p === null)) return null;
  return parts as ProductCategory[];
}

export type CategoryFilter =
  /** Legacy `?category=` with no threshold: any member, free-text match. */
  | { kind: 'contains'; text: string }
  /** `?category=NRPS&categoryMinShare=50`: share of members, exact category. */
  | { kind: 'share'; category: ProductCategory; minShare: number };

/** Refused with a 400 rather than dropped: dropping a filter answers a wider question. */
export class CategoryShareFilterError extends Error {
  constructor(message: string, readonly rejected: string[]) {
    super(message);
    this.name = 'CategoryShareFilterError';
  }
}

const categoryParam = (params: URLSearchParams): string => {
  for (const name of ['category', 'productType']) {
    const value = params.get(name)?.trim();
    if (value) return value;
  }
  return '';
};

/**
 * Without a threshold the legacy any-member text match is kept, because
 * `?category=NRPS` is in shared links. With one, the category must be exact.
 */
export function parseCategoryFilter(params: URLSearchParams): CategoryFilter | null {
  const text = categoryParam(params);
  const rawShare = params.get('categoryMinShare')?.trim() ?? '';

  if (!text) {
    if (rawShare) {
      throw new CategoryShareFilterError(
        '?categoryMinShare= needs a ?category= to apply to. Add one (NRPS, PKS, RiPP, '
        + 'terpene, saccharide or other) or drop the threshold.',
        ['categoryMinShare'],
      );
    }
    return null;
  }
  if (!rawShare) return { kind: 'contains', text };

  const minShare = Number(rawShare);
  if (!Number.isFinite(minShare) || minShare < 0 || minShare > 100) {
    throw new CategoryShareFilterError(
      `?categoryMinShare=${rawShare} is not a percentage. Use a number from 0 (any `
      + 'member) to 100.',
      ['categoryMinShare'],
    );
  }
  const category = canonicalCategory(text);
  if (!category) {
    throw new CategoryShareFilterError(
      `"${text}" is not a product category, so it has no share of members. Use one of `
      + `${PRODUCT_CATEGORY_VALUES.join(', ')}, or drop ?categoryMinShare= to match `
      + 'the text against any member.',
      ['category'],
    );
  }
  return { kind: 'share', category, minShare };
}

/** Null unless the filter names exactly one category; backends then use their default order. */
export function categoryForShareSort(params: URLSearchParams): ProductCategory | null {
  const text = categoryParam(params);
  return text ? canonicalCategory(text) : null;
}

export const CATEGORY_SHARE_SORT_FIELD = 'categoryShare';
