/**
 * Caps on the GBK zip exports, shared with the export UI. Regions are read at
 * ~39/s and ~94 KB each, so 100,000 is ~45 min and ~9.4 GB. The family cap fits
 * the largest v3 families (just under 150,000 primary members, ~1 h, ~14 GB zip).
 */
export const GCF_GBK_EXPORT_MAX_MEMBERS = 150_000;

/** The first matches in the search's sort order. */
export const PROPERTY_GBK_EXPORT_MAX_REGIONS = 100_000;

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/** One address, no list: a comma-joined value would reach every recipient in it. */
export function isValidExportEmail(value: string): boolean {
  return EMAIL_RE.test(value);
}
