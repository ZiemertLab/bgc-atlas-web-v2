// How a family's member shares are SHOWN: the "why this row matched" cells on
// /gcfs, and the denominator every ecosystem percentage names.
//
// Two denominators, never mixed:
//   products    % of the family's primary members carrying the product
//               (product_type_member_share, 2 dp)
//   ecosystems  % of the members WITH an ecosystem at GOLD level n
//               (biome_distribution_l<n>, 1 dp), with resolved_pct_l<n> -- the
//               share of members that have one -- beside it
//
// Membership ("does this value reach T") is read from the precomputed threshold
// arrays, never from comparing a displayed percentage with T: the ecosystem
// shares here are rounded to 1 dp and the arrays were cut on 2 dp, so 49.96
// displays as 50.0 yet is correctly NOT in eco_l<n>_ge50.
//
// Client-safe and pure.
import type { FilterCondition, FilterGroup } from '@/lib/filters/types';
import { resolveShareCondition, type ShareQuery } from '@/lib/filters/share-fields';
import type { GcfListItem } from '@/lib/hooks/use-gcfs';

/** Decimals each share is stored with, so a display never claims more precision. */
const PRODUCT_DECIMALS = 2;
const ECOSYSTEM_DECIMALS = 1;

const fmt = (value: number, decimals: number, locale?: string) =>
  value.toLocaleString(locale, { maximumFractionDigits: decimals });

/** "of members" / "of members with an L3 ecosystem". */
export const shareDenominator = (query: Pick<ShareQuery, 'spec'>): string =>
  query.spec.kind === 'product' ? 'of members' : `of members with an L${query.spec.level} ecosystem`;

/** The same, short enough for the combined "Matched filters" cell:
 *  "of members" / "of members with L3". The title spells it out. */
export const shortShareDenominator = (query: Pick<ShareQuery, 'spec'>): string =>
  query.spec.kind === 'product' ? 'of members' : `of members with L${query.spec.level}`;

/** The label an ecosystem bar's tooltip carries after each percentage. */
export const ecosystemValueLabel = (level: number) => `of members with an L${level} ecosystem`;

/** "63.1 % of members have an L3 ecosystem", or undefined when not known. */
export function ecosystemResolvedNote(
  level: number,
  resolvedPct: number | null | undefined,
  locale?: string,
): string | undefined {
  if (resolvedPct === null || resolvedPct === undefined || !Number.isFinite(resolvedPct)) return undefined;
  return `${formatResolvedPct(resolvedPct, locale)} % of members have an L${level} ecosystem`;
}

/** Resolved share at 1 dp, with the ends kept honest: a family where 99.96 % of
 *  members have an ecosystem does not read "100 %", nor 0.04 % read "0 %". */
export function formatResolvedPct(pct: number, locale?: string): string {
  if (pct > 0 && pct < 0.1) return `< ${fmt(0.1, 1, locale)}`;
  if (pct < 100 && pct > 99.9) return `> ${fmt(99.9, 1, locale)}`;
  return fmt(pct, 1, locale);
}

/** The /gcfs-style header tooltip of a GOLD Ecosystem distribution column. */
export const ecosystemColumnTooltip = (level: number) =>
  `Share of the members with a level-${level} GOLD ecosystem in each one. Members with no ` +
  `level-${level} ecosystem are left out of the bar, so it is not a share of all members.`;

/**
 * A stored share as text: `34.6`, `0.01`, `< 0.01` (present but rounded to
 * zero), `0` (absent -- no member). `belowThreshold` is set when the value is
 * known NOT to reach that threshold (from the arrays): a 1-dp share that rounds
 * up to it then reads `< 50`, never `50`.
 */
export function formatShareValue(
  value: number | undefined,
  decimals: number,
  { belowThreshold, locale }: { belowThreshold?: number; locale?: string } = {},
): string {
  if (value === undefined || !Number.isFinite(value)) return '0';
  const unit = 10 ** -decimals;
  if (belowThreshold !== undefined && belowThreshold > 0 && value >= belowThreshold) {
    return `< ${fmt(belowThreshold, decimals, locale)}`;
  }
  if (value < unit) return `< ${fmt(unit, decimals, locale)}`;
  return fmt(value, decimals, locale);
}

/** One share condition of the applied filters, as a column. */
export interface ShareMatchCondition {
  /** Stable for one condition: field, sense, threshold and values. */
  key: string;
  /** A column id derived from the key; keeps a reader's Columns choice. */
  columnId: string;
  query: ShareQuery;
}

const hash = (text: string) => {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36);
};

/**
 * Every honoured share condition in the group, nested groups included, in the
 * order the reader wrote them; duplicates once. A condition the backends would
 * refuse (resolveShareCondition null) never gets a column: the page shows the
 * refusal instead.
 */
export function shareConditionsOf(group: FilterGroup | null | undefined): ShareMatchCondition[] {
  if (!group) return [];
  const out: ShareMatchCondition[] = [];
  const seen = new Set<string>();
  const walk = (node: FilterGroup) => {
    for (const condition of node.conditions ?? []) add(condition);
    for (const child of node.groups ?? []) walk(child);
  };
  const add = (condition: FilterCondition) => {
    const query = resolveShareCondition(condition);
    if (!query) return;
    const key = [
      condition.field,
      query.negated ? 'not' : 'is',
      query.threshold,
      [...query.values].sort().join('\u0000'),
    ].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ key, columnId: `shareMatch_${hash(key)}`, query });
  };
  walk(group);
  return out;
}

/** The subject a header names: the one value, or the field when several. */
const subjectOf = (query: ShareQuery) => {
  const level = query.spec.kind === 'ecosystem' ? ` (L${query.spec.level})` : '';
  if (query.values.length === 1) return `${query.values[0]}${level}`;
  return query.spec.kind === 'product' ? 'Product' : `Ecosystem${level}`;
};

/** "Marine (L3) ≥ 90 %", "Product (any member)", "lanthipeptide-class-i < 50 %". */
export function shareConditionLabel(query: ShareQuery): string {
  const subject = subjectOf(query);
  if (query.threshold === 0) return `${subject} (${query.negated ? 'no member' : 'any member'})`;
  return `${subject} ${query.negated ? '<' : '≥'} ${query.threshold} %`;
}

/** The header tooltip: what the cell shows and over which members. */
export function shareConditionTooltip(query: ShareQuery): string {
  const values = query.values.join(', ');
  const what = query.spec.kind === 'product'
    ? 'Share of the family’s members carrying'
    : `Share of the members with a level-${query.spec.level} GOLD ecosystem that are in`;
  const which = query.negated
    ? (query.values.length > 1 ? 'each of' : '')
    : (query.values.length > 1 ? 'each listed value that reaches the threshold, highest first:' : '');
  return `Why each row matched. ${what} ${which ? `${which} ` : ''}${values}.`;
}

export type ShareMatchStatus =
  /** The row meets the condition; entries say by how much. */
  | 'matched'
  /** The row does not meet it: another branch of an OR group matched. */
  | 'other'
  /** The family has no member with an ecosystem at this level. */
  | 'unresolved'
  /** The shares are not on this row (index without them, unlisted family). */
  | 'unavailable';

export interface ShareMatchEntry {
  value: string;
  /** Stored share, or undefined when no member has it. */
  share: number | undefined;
  /** The share as text, without the unit: `34.6`, `< 0.01`, `0`. */
  text: string;
}

export interface ShareMatch {
  status: ShareMatchStatus;
  entries: ShareMatchEntry[];
  /** "of members" / "of members with an L3 ecosystem". */
  denominator: string;
  /** Ecosystems: "63.1 % of members have an L3 ecosystem". */
  resolvedNote?: string;
}

type ShareRow = Pick<
  GcfListItem,
  | 'productTypeMemberShare'
  | 'productTypesAtLeast'
  | 'biomeDistributionByLevel'
  | 'ecosystemsAtLeastByLevel'
  | 'ecosystemResolvedPctByLevel'
>;

/**
 * Why `row` matched `query`, from the row's own share fields.
 *
 * Positive: the values that reach the threshold, highest share first.
 * Negated: every listed value with its (below-threshold) share -- that IS the
 * reason the row matched, and "—" would hide it. A row that does not meet the
 * condition (an OR elsewhere matched) is 'other', never shown as a match.
 */
export function shareMatchFor(row: ShareRow, query: ShareQuery, locale?: string): ShareMatch {
  const denominator = shareDenominator(query);
  // All share fields are present together or not at all (gcf-browse-mapper).
  if (!row.productTypeMemberShare) return { status: 'unavailable', entries: [], denominator };

  let shares: Record<string, number>;
  let reaching: Set<string>;
  let decimals: number;
  let resolvedNote: string | undefined;
  if (query.spec.kind === 'product') {
    shares = row.productTypeMemberShare;
    decimals = PRODUCT_DECIMALS;
    reaching = new Set(query.threshold === 0
      ? Object.keys(shares)
      : row.productTypesAtLeast?.[query.threshold as 10 | 50 | 90] ?? []);
  } else {
    const { level } = query.spec;
    shares = row.biomeDistributionByLevel?.[level] ?? {};
    decimals = ECOSYSTEM_DECIMALS;
    const resolved = row.ecosystemResolvedPctByLevel?.[level];
    resolvedNote = ecosystemResolvedNote(level, resolved, locale);
    if (!resolved || resolved <= 0) {
      return { status: 'unresolved', entries: [], denominator, resolvedNote };
    }
    // Threshold 0 is eco_l<n>_any, which IS the keys of this distribution.
    reaching = new Set(query.threshold === 0
      ? Object.keys(shares)
      : row.ecosystemsAtLeastByLevel?.[level]?.[query.threshold as 10 | 50 | 90] ?? []);
  }

  const hits = query.values.filter((value) => reaching.has(value));
  const meets = query.negated ? hits.length === 0 : hits.length > 0;
  if (!meets) return { status: 'other', entries: [], denominator, resolvedNote };

  const shown = query.negated ? query.values : hits;
  const entries = shown
    .map((value) => {
      const share = Object.prototype.hasOwnProperty.call(shares, value) ? shares[value] : undefined;
      return {
        value,
        share,
        text: formatShareValue(share, decimals, {
          belowThreshold: query.negated ? query.threshold : undefined,
          locale,
        }),
      };
    })
    .sort((a, b) => (b.share ?? -1) - (a.share ?? -1) || a.value.localeCompare(b.value));
  return { status: 'matched', entries, denominator, resolvedNote };
}

/** "Marine: 34.6 % of members with an L3 ecosystem" (several joined by "; "). */
export function shareMatchText(match: ShareMatch): string {
  if (match.status !== 'matched') return '';
  return `${match.entries.map((e) => `${e.value}: ${e.text} %`).join('; ')} ${match.denominator}`;
}

/** Why a cell is blank, for its title. */
export function shareMatchBlankReason(match: ShareMatch, query: ShareQuery): string {
  switch (match.status) {
    case 'other':
      return 'This family does not meet this condition; another condition of the filter matched it.';
    case 'unresolved':
      return query.spec.kind === 'ecosystem'
        ? `No member of this family has a level-${query.spec.level} GOLD ecosystem.`
        : '';
    case 'unavailable':
      return 'Member shares are not available for this family.';
    default:
      return '';
  }
}

/**
 * A family's product member shares for a file: `RiPP-like 99.96%; hserlactone
 * 0.03%`, every product, largest first. Unlike formatShares nothing is dropped
 * or rounded to 1 dp -- the one lanthipeptide member in 12,278 is the 0.01 %
 * this column exists to show. A share stored as 0.00 reads `<0.01%`.
 */
export function formatMemberShares(shares: Record<string, number> | null | undefined): string {
  if (!shares) return '';
  return Object.entries(shares)
    .filter(([, v]) => Number.isFinite(v))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k} ${v < 0.01 ? '<0.01' : v.toFixed(2).replace(/\.?0+$/, '')}%`)
    .join('; ');
}
