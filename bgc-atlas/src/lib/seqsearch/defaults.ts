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

export interface SearchParameters {
  eValue: string;
  identity: number;
  coverage: number;
  maxResults: number;
}

export type ParsedSearchParameters =
  | { ok: true; value: SearchParameters }
  | { ok: false; error: string };

// A plain decimal or exponent, and nothing else: the value ends up on a DIAMOND command line.
// The digit runs must not overlap: `\d+\.?\d*` let a long digit string with a bad last
// character backtrack quadratically -- 40,000 digits held the event loop 1.3 s, and the
// field is anonymous input. No real E-value is longer than E_VALUE_MAX_LENGTH either.
const E_VALUE_RE = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/;
const E_VALUE_MAX_LENGTH = 32;

/** undefined for "not submitted"; NaN for anything that is not a number or numeric string. */
function numberOrUnset(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return value.trim() === '' ? undefined : Number(value.trim());
  return NaN;
}

/**
 * Validate the submitted thresholds and apply the defaults, before anything is written or queued.
 *
 * Every value here reaches DIAMOND's argv, and in ssh-docker mode that argv is read by a remote
 * shell. A JSON body can carry a string where a number is expected, and `"1 $(…)" < 1` is
 * false, so a range check alone let one through; each value must be a number first.
 */
export function parseSearchParameters(raw: {
  eValue?: unknown;
  minIdentity?: unknown;
  minCoverage?: unknown;
  maxResults?: unknown;
}): ParsedSearchParameters {
  const identity = numberOrUnset(raw.minIdentity);
  if (identity !== undefined && !(Number.isFinite(identity) && identity >= 0 && identity <= 100)) {
    return { ok: false, error: 'Identity must be between 0 and 100' };
  }

  const coverage = numberOrUnset(raw.minCoverage);
  if (coverage !== undefined && !(Number.isFinite(coverage) && coverage >= 0 && coverage <= 100)) {
    return { ok: false, error: 'Coverage must be between 0 and 100' };
  }

  const maxResults = numberOrUnset(raw.maxResults);
  if (maxResults !== undefined && !(Number.isInteger(maxResults) && maxResults >= 1 && maxResults <= 1000)) {
    return { ok: false, error: 'Max results must be a whole number between 1 and 1,000' };
  }

  let eValue = SEARCH_DEFAULTS.eValue;
  if (raw.eValue !== undefined && raw.eValue !== null && String(raw.eValue).trim() !== '') {
    if (typeof raw.eValue !== 'string' && typeof raw.eValue !== 'number') {
      return { ok: false, error: 'E-value must be a positive number, e.g. 1e-5' };
    }
    const text = String(raw.eValue).trim();
    if (text.length > E_VALUE_MAX_LENGTH || !E_VALUE_RE.test(text)
      || !(Number(text) > 0) || !Number.isFinite(Number(text))) {
      return { ok: false, error: 'E-value must be a positive number, e.g. 1e-5' };
    }
    eValue = text;
  }

  return {
    ok: true,
    value: {
      eValue,
      identity: thresholdOrDefault(identity, SEARCH_DEFAULTS.identity),
      coverage: thresholdOrDefault(coverage, SEARCH_DEFAULTS.coverage),
      maxResults: maxResults ?? SEARCH_DEFAULTS.maxResults,
    },
  };
}
