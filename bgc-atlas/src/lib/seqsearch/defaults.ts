// Shared by the submit form, submit route and worker so they cannot drift. The DB columns
// carry matching defaults.
export interface SearchDefaults {
  eValue: string;
  /** Percent; DIAMOND --id. */
  identity: number;
  /** Percent; --query-cover for blastp, --subject-cover for blastx. */
  coverage: number;
  maxResults: number;
}

// Not `as const`: these seed form state, which would then get literal types.
export const SEARCH_DEFAULTS: SearchDefaults = {
  eValue: '1e-5',
  identity: 50,
  coverage: 80,
  maxResults: 1000,
};

// 0 means "not set", not "no floor". Clamped here, not in the worker, so the stored
// parameters equal the ones DIAMOND is given.
export function thresholdOrDefault(value: number | undefined, fallback: number): number {
  return value !== undefined && value > 0 ? value : fallback;
}
