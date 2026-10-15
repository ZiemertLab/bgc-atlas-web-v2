// Median over complete members only: most BGCs are contig fragments far shorter than the
// cluster. Families with no complete member fall back to the longest member, shown with '≥'.

export interface GcfLengthStats {
  /** bp; null when the family has no complete member. */
  medianCompleteLen: number | null;
  minLen: number | null;
  maxLen: number | null;
  completeCount: number;
  memberCount: number;
}

export interface FormattedBgcLength {
  /** e.g. '21.9 kb' or '≥28.8 kb'. */
  text: string;
  isBound: boolean;
  valueBp: number;
  tooltip: string;
}

function toKb(bp: number): string {
  const kb = bp / 1000;
  return kb < 100 ? `${kb.toFixed(1)} kb` : `${Math.round(kb)} kb`;
}

export function formatKb(bp: number | null | undefined): string {
  return bp === null || bp === undefined ? '—' : toKb(bp);
}

export function formatBgcLength(stats: GcfLengthStats | null | undefined): FormattedBgcLength | null {
  if (!stats) return null;

  const valueBp = stats.medianCompleteLen ?? stats.maxLen;
  if (valueBp === null || valueBp === undefined) return null;

  const isBound = stats.completeCount === 0;
  const range = stats.minLen !== null && stats.maxLen !== null && stats.minLen !== stats.maxLen
    ? ` Members range ${toKb(stats.minLen)}–${toKb(stats.maxLen)}.`
    : '';

  const tooltip = isBound
    ? `Lower bound: no complete member among ${stats.memberCount.toLocaleString()} — this is the longest one observed, so the family's cluster is at least this long.${range}`
    : `Median length of the ${stats.completeCount.toLocaleString()} complete member${stats.completeCount === 1 ? '' : 's'} of ${stats.memberCount.toLocaleString()}. Partial members are excluded because contig fragments are much shorter than the cluster.${range}`;

  return { text: `${isBound ? '≥' : ''}${toKb(valueBp)}`, isBound, valueBp, tooltip };
}
