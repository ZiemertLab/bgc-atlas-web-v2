// MIMAG bands for CheckM figures -- the same thresholds genome_quality is derived
// from. Shared by the genome-QC panel and the /genome-collections columns so a
// figure is coloured the same way wherever it appears.

export type MimagBand = 'high' | 'medium' | 'low';

export function completenessBand(value: number): MimagBand {
  if (value >= 90) return 'high';
  if (value >= 50) return 'medium';
  return 'low';
}

export function contaminationBand(value: number): MimagBand {
  if (value <= 5) return 'high';
  if (value < 10) return 'medium';
  return 'low';
}

/** Status tokens: a band is a quality outcome, so it reads as one. */
export const MIMAG_TEXT_CLASS: Record<MimagBand, string> = {
  high: 'text-success',
  medium: 'text-warning',
  low: 'text-destructive',
};

export const MIMAG_BADGE_CLASS: Record<MimagBand, string> = {
  high: 'text-success border-success/40 bg-success/10',
  medium: 'text-warning border-warning/40 bg-warning/10',
  low: 'text-destructive border-destructive/40 bg-destructive/10',
};

export const COMPLETENESS_NOTE: Record<MimagBand, string> = {
  high: 'Meets the MIMAG high-quality threshold (≥ 90 %)',
  medium: 'Meets the MIMAG medium-quality threshold (≥ 50 %), not high (≥ 90 %)',
  low: 'Below the MIMAG medium-quality threshold (≥ 50 %)',
};

export const CONTAMINATION_NOTE: Record<MimagBand, string> = {
  high: 'Meets the MIMAG high-quality threshold (≤ 5 %)',
  medium: 'Meets the MIMAG medium-quality threshold (< 10 %), not high (≤ 5 %)',
  low: 'Above the MIMAG medium-quality threshold (< 10 %)',
};
