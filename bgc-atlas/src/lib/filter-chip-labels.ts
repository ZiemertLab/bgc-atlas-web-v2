/**
 * Chip values for the FilterChips row on the list pages (/bgcs, /samples,
 * /genome-collections). Every active filter gets a chip, including the column
 * filters a copied link can carry while their filter rows are closed, their
 * column is hidden, or the page is in map view. Pure, so the pages share one
 * reading of each value.
 */

/**
 * The value a chip shows for a debounced filter: the APPLIED value, which is
 * what the request carries, so the chip does not flicker while the user types.
 * But only while the input still holds something: a chip cleared by its ×
 * (or a field emptied) disappears at once instead of lingering for the debounce.
 */
export const appliedFilterValue = (live: string, applied: string): string =>
  live ? applied : '';

/** A filter number as the page shows numbers: "1,000", "0.25". A value that is
 *  not a number is shown as it arrived, so the chip never reads "NaN". */
export const formatFilterNumber = (raw: string): string => {
  const n = Number(raw);
  return raw.trim() !== '' && Number.isFinite(n)
    ? n.toLocaleString(undefined, { maximumFractionDigits: 10 })
    : raw;
};

/**
 * One chip value for a min/max pair: "100–500", "≥ 100", "≤ 500", or '' when
 * neither bound is set. `unit` follows the last figure ("50–90%", "≥ 5,000 bp").
 */
export const formatRangeLabel = (min: string, max: string, unit = ''): string => {
  const lo = min ? formatFilterNumber(min) : '';
  const hi = max ? formatFilterNumber(max) : '';
  if (lo && hi) return `${lo}–${hi}${unit}`;
  if (lo) return `≥ ${lo}${unit}`;
  if (hi) return `≤ ${hi}${unit}`;
  return '';
};

/**
 * A select filter's value as its dropdown shows it. Falls back to the value
 * itself: data-source options load after the first render, and a value the
 * options do not hold is still sent (the server decides), so the chip must
 * still say something.
 */
export const optionLabel = (
  options: readonly { label: string; value: string }[],
  value: string,
): string => options.find((o) => o.value === value)?.label ?? value;

/**
 * "13–13.5°N, 17°W–16.5°W" for an area chip. Half-open boxes (only a min or
 * only a max) come from hand-edited URLs, so each side degrades to an open bound
 * rather than rendering NaN.
 */
export function formatAreaLabel(bbox: {
  latMin?: string;
  latMax?: string;
  lonMin?: string;
  lonMax?: string;
}): string {
  const deg = (v: string | undefined, pos: string, neg: string): string | null => {
    const n = Number(v);
    if (v === undefined || v === '' || !Number.isFinite(n)) return null;
    // Trailing zeros dropped so whole degrees read "54°N", not "54.00°N".
    return `${Math.abs(n).toFixed(2).replace(/\.?0+$/, '')}°${n < 0 ? neg : pos}`;
  };
  const span = (min: string | null, max: string | null) =>
    min && max ? `${min}–${max}` : min ? `≥ ${min}` : max ? `≤ ${max}` : null;

  return [
    span(deg(bbox.latMin, 'N', 'S'), deg(bbox.latMax, 'N', 'S')),
    span(deg(bbox.lonMin, 'E', 'W'), deg(bbox.lonMax, 'E', 'W')),
  ].filter(Boolean).join(', ');
}
