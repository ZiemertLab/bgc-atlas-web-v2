// Whether the index behind the gcf_browse alias carries eco_l1_any .. eco_l5_any
// (the "any member" ecosystem threshold).
//
// The Ecosystem share filter's "any member" reads those lists on the index. Until
// the patch that adds them is swapped in, a `terms` query on them would match
// NOTHING, at HTTP 200 -- the silent wrong answer the browse layer refuses. So
// while they are absent the index does not serve such a condition at all
// (supportsAdvancedBrowse says no) and the request goes to the SQL fallback,
// which reads gcf_distributions_mv directly and answers correctly either way.
//
// The check is one `_mapping/field` request, cached per process for a minute, so
// an alias swap -- or a rollback -- is picked up within a minute, no restart.
// Synchronous callers (the support gate) read the last known answer and trigger
// a refresh when it is stale. It is kicked once at module load; until the first
// answer it is `false`, which only ever costs a slower, correct answer.
//
// A FAILED check (non-200, network, timeout) is not an answer: the last known
// value stands and the check is retried 30 s later. Only a 200 whose body lacks
// the fields writes `false`.
import { ECO_SHARE_LEVELS } from '@/lib/filters/share-fields';

const OPENSEARCH_URL = process.env.OPENSEARCH_URL || 'http://134.2.9.199:19200';
const GCF_BROWSE_INDEX = process.env.OPENSEARCH_GCF_BROWSE_INDEX || 'gcf_browse';
export const ECO_ANY_TTL_MS = 60 * 1000;
export const ECO_ANY_RETRY_MS = 30 * 1000;

export const ECO_ANY_FIELDS = ECO_SHARE_LEVELS.map((level) => `eco_l${level}_any`);

/** `at` is when the value was taken; a failed check backdates it so the next
 *  look comes after ECO_ANY_RETRY_MS rather than a full TTL. */
let known: { value: boolean; at: number } | null = null;
let inflight: Promise<boolean> | null = null;

/** True only when EVERY index behind the alias maps all five fields. */
export const mappingHasEcoAny = (body: unknown): boolean => {
  if (!body || typeof body !== 'object') return false;
  const indexes = Object.values(body as Record<string, { mappings?: Record<string, unknown> }>);
  return indexes.length > 0
    && indexes.every((index) => ECO_ANY_FIELDS.every((field) => Boolean(index?.mappings?.[field])));
};

const refresh = (): Promise<boolean> => {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(
        `${OPENSEARCH_URL}/${GCF_BROWSE_INDEX}/_mapping/field/${ECO_ANY_FIELDS.join(',')}`,
        { signal: AbortSignal.timeout(5_000) },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const value = mappingHasEcoAny(await res.json());
      known = { value, at: Date.now() };
      return value;
    } catch {
      // Keep what we knew; look again in ECO_ANY_RETRY_MS rather than a full TTL.
      const value = known?.value ?? false;
      known = { value, at: Date.now() - ECO_ANY_TTL_MS + ECO_ANY_RETRY_MS };
      return value;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
};

const stale = () => !known || Date.now() - known.at >= ECO_ANY_TTL_MS;

/** The last known answer, refreshing in the background when stale. */
export const ecoAnyIndexed = (): boolean => {
  if (stale()) void refresh();
  return known?.value ?? false;
};

/** The answer, waiting for a refresh when stale (async callers). */
export const ecoAnyIndexedFresh = async (): Promise<boolean> =>
  (stale() ? refresh() : Promise.resolve(known?.value ?? false));

/** Tests only: pin the answer, or `null` to forget it (and any refresh in flight). */
export const setEcoAnyIndexedForTests = (value: boolean | null) => {
  known = value === null ? null : { value, at: Date.now() };
  inflight = null;
};

// Not under test: suites pin or mock the answer, and a request to the cluster
// from an import would make every suite that loads this module depend on it.
if (process.env.NODE_ENV !== 'test') void refresh();
