// Map legend colours reuse the Atlas palettes (GOLD ecosystem, product category) where they exist.
import { GEO_OTHER_KEY } from '@/lib/opensearch/geo-grid';
import { getProductCategoryColor, SOURCE_TYPE_COLORS } from '@/lib/utils/chart-utils';
import {
  bucketStroke, GOLD_BUCKET_COLOR, GOLD_BUCKET_LABEL, type GoldBucket,
} from '@/lib/utils/gold-buckets';

const OTHER_COLOR = '#4b5563';

/** Okabe-Ito-derived and validated (worst deutan ΔE 9.5; raw yellow fails contrast). Assigned by legend rank. */
const CATEGORICAL = [
  '#0072b2', '#d55e00', '#009e73', '#785ef0',
  '#e69f00', '#56b4e9', '#cc79a7', '#8b5a2b',
];

const stripRank = (s: string) => s.replace(/^[a-z]__/, '');

export function legendColor(field: string | null, key: string, index: number): string {
  if (key === GEO_OTHER_KEY) return OTHER_COLOR;
  if (field === 'gold_ecosystem') return GOLD_BUCKET_COLOR[key as GoldBucket] ?? OTHER_COLOR;
  if (field === 'product_category') return getProductCategoryColor(key);
  if (field === 'sample_type') return SOURCE_TYPE_COLORS[key] ?? CATEGORICAL[index % CATEGORICAL.length];
  return CATEGORICAL[index % CATEGORICAL.length];
}

export function legendLabel(field: string | null, key: string): string {
  if (key === GEO_OTHER_KEY) return 'Other / unset';
  if (field === 'gold_ecosystem') return GOLD_BUCKET_LABEL[key as GoldBucket] ?? key;
  if (field === 'tax_phylum') return stripRank(key);
  return key;
}

/** GOLD's yellow bucket needs a darker, thicker stroke on the pale basemap, as on the sample maps. */
export function legendStroke(field: string | null, key: string): { color: string; weight: number } {
  if (field === 'gold_ecosystem') return bucketStroke(key as GoldBucket);
  return { color: '#ffffff', weight: 0.5 };
}
