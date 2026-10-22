/**
 * List pages keep their filters, sort, page and page size in the URL so that
 * Copy link and Back reproduce the view. Display preferences (column
 * visibility and widths, expanded rows, chart rank or level) stay out of it.
 *
 * Pure: no React or Next imports, so components and node tests can use it
 * without pulling in the router. The hook is `useMirrorToUrl` in
 * `@/lib/hooks/use-mirror-to-url`.
 */

/** The page sizes `Pagination` offers when a page does not pass its own. */
export const DEFAULT_PAGE_SIZE_OPTIONS: readonly number[] = [10, 25, 50, 100];

/**
 * One URL param mirrored from page state. An empty string, or a value equal to
 * the default, removes the param. Numbers are stringified, so `0` is kept
 * unless it is the default.
 */
export type UrlEntry = readonly [key: string, value: string | number, defaultValue?: string | number];

/**
 * The query string for `entries` laid over `current`. Params the page does not
 * own are kept as they are.
 */
export function mergeQuery(current: URLSearchParams | string, entries: readonly UrlEntry[]): string {
  const params = new URLSearchParams(current.toString());
  for (const [key, rawValue, rawDefault = ''] of entries) {
    const value = String(rawValue);
    if (value && value !== String(rawDefault)) params.set(key, value);
    else params.delete(key);
  }
  return params.toString();
}

/**
 * The URL to replace() to so it reflects `entries`, or null when the current
 * URL already does. The null is the loop guard: replace() changes searchParams,
 * which re-renders, which must then find nothing to write.
 */
export function nextUrl(
  pathname: string,
  current: URLSearchParams | string,
  entries: readonly UrlEntry[],
): string | null {
  const query = mergeQuery(current, entries);
  if (query === new URLSearchParams(current.toString()).toString()) return null;
  return `${pathname}${query ? `?${query}` : ''}`;
}

/** A query string in the form nextUrl writes and useSearchParams reads back. */
export const normaliseQuery = (query: URLSearchParams | string): string =>
  new URLSearchParams(query.toString()).toString();

/** How many of a route's own writes may be in flight before the oldest is forgotten. */
export const OWN_WRITES_CAP = 8;

export type NavigationKind = 'same' | 'own' | 'external';

/**
 * What a change of query string on a mirrored page was:
 * - 'same': nothing changed since the page last looked (`seen`).
 * - 'own': one of the queries the page's mirror wrote itself and that has not
 *   arrived yet (`ownWrites`, oldest first). The page's state already says it,
 *   or says something newer that is on its way; nothing to do. A list, not the
 *   last write: two quick writes (Next page twice, a sort toggle) can arrive in
 *   either order, or the older one not at all.
 * - 'external': anything else: a nav click to the bare route, a link to the same
 *   route with other params, Back or Forward between two such entries. The page
 *   must re-seed from the URL, as on a fresh visit, or its mirror writes the old
 *   state straight back over it.
 *
 * Everything is compared normalised, so `a=1&b=x+y` and `a=1&b=x%20y` are one query.
 */
export function classifyNavigation(
  current: URLSearchParams | string,
  seen: URLSearchParams | string,
  ownWrites: readonly string[],
): NavigationKind {
  const now = normaliseQuery(current);
  if (now === normaliseQuery(seen)) return 'same';
  if (ownWrites.some((w) => normaliseQuery(w) === now)) return 'own';
  return 'external';
}

/** `ownWrites` with `query` appended, keeping the newest OWN_WRITES_CAP. */
export function recordOwnWrite(ownWrites: readonly string[], query: string): string[] {
  return [...ownWrites, query].slice(-OWN_WRITES_CAP);
}

/**
 * `ownWrites` once `query` has arrived: it and every older write are dropped.
 * An older write cannot arrive after a newer one: the app router discards a
 * pending navigation when a newer one starts (Next 15.5, app-router-instance).
 * If one ever did, it would read as external and re-seed, which is safe, only
 * wasteful. A query not in the list leaves it unchanged, so consuming twice
 * (StrictMode) is harmless.
 */
export function consumeOwnWrite(ownWrites: readonly string[], query: URLSearchParams | string): string[] {
  const now = normaliseQuery(query);
  let last = -1;
  ownWrites.forEach((w, i) => {
    if (normaliseQuery(w) === now) last = i;
  });
  return ownWrites.slice(last + 1);
}

/** `page` in the URL is 1-based; state is 0-based. Garbage reads as the first page. */
export const readPage = (raw: string | null): number => {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n - 1 : 0;
};

/** A `size` the page does not offer reads as `fallback`. */
export const readPageSize = (raw: string | null, allowed: readonly number[], fallback: number): number => {
  const n = Number(raw);
  return allowed.includes(n) ? n : fallback;
};

/**
 * A URL value the page offers, or `fallback`: a junk value must not reach the
 * API or paint a chip or sort arrow that matches nothing. Without a fallback, a
 * value outside `allowed` reads as '' (no filter).
 */
export function readOneOf<T extends string>(raw: string, allowed: readonly T[], fallback: T): T;
export function readOneOf<T extends string>(raw: string, allowed: readonly T[]): T | '';
export function readOneOf<T extends string>(raw: string, allowed: readonly T[], fallback: T | '' = ''): T | '' {
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

/** A range bound from the URL: kept only if it is a number, so junk is not sent as NaN. */
export const readNumber = (raw: string): string =>
  raw.trim() !== '' && Number.isFinite(Number(raw)) ? raw : '';
