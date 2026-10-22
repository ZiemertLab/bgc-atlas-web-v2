/**
 * The share columns on gcf_distributions_mv, named exactly as
 * gcf_browse names its fields, so a Postgres row can be handed to the index
 * mapper (`mapShareFields`) unchanged. Read by the /api/gcfs SQL fallback and by
 * the unlisted-family documents (postgres-documents.ts), so neither path renders
 * the share cells blank.
 *
 * Server-only (Prisma).
 */
import { Prisma } from '@prisma/client';

type Level = 1 | 2 | 3 | 4 | 5;
type Threshold = 10 | 50 | 90;

export type ShareFieldColumn =
  | 'product_type_member_share'
  | `product_types_ge${Threshold}`
  | `eco_l${Level}_ge${Threshold}`
  | `resolved_pct_l${Level}`
  | `dom_ecosystem_l${Level}`
  | `max_pct_l${Level}`;

const LEVELS: Level[] = [1, 2, 3, 4, 5];
const THRESHOLDS: Threshold[] = [10, 50, 90];

export const SHARE_FIELD_COLUMNS: readonly ShareFieldColumn[] = [
  'product_type_member_share',
  ...THRESHOLDS.map((t) => `product_types_ge${t}` as const),
  ...LEVELS.flatMap((n) => [
    ...THRESHOLDS.map((t) => `eco_l${n}_ge${t}` as const),
    `resolved_pct_l${n}` as const,
    `dom_ecosystem_l${n}` as const,
    `max_pct_l${n}` as const,
  ]),
];

/** A row carrying the share columns as Postgres returns them (jsonb, text[],
 *  numeric as a Decimal, or null). */
export type ShareFieldRow = { [K in ShareFieldColumn]: unknown };

/** `d.product_type_member_share, d.product_types_ge10, ...` for a SELECT list.
 *  Literal identifiers only, never input. */
export const shareFieldSelect = (alias: string): Prisma.Sql =>
  Prisma.raw(SHARE_FIELD_COLUMNS.map((column) => `${alias}.${column}`).join(', '));

/** The share columns of `row`, as a browse-document fragment. */
export const pickShareFields = (row: ShareFieldRow): Record<ShareFieldColumn, unknown> =>
  Object.fromEntries(SHARE_FIELD_COLUMNS.map((column) => [column, row[column]])) as Record<ShareFieldColumn, unknown>;
