import { apiFetch } from '@/lib/basePath';
import { isErrorReference, withReference } from '@/lib/api/error-messages';
import { DEEP_PAGE_CODE, FILTER_REFUSED_CODE } from '@/lib/api/refusal-codes';

export class ApiError extends Error {
  status: number;
  body?: string;

  constructor(status: number, message: string, body?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

// A 4xx is an answer, not a transient failure; retrying only delays the 404 page.
export const retryUnlessClientError = (failureCount: number, error: unknown): boolean =>
  !(error instanceof ApiError && error.status >= 400 && error.status < 500) &&
  // Nor a 503 the server wrote for the reader (userFacing503 below): it already
  // said when to come back, and asking again at once re-runs a query that was
  // refused for being too heavy, or queues again for a slot that was full.
  !(error instanceof ApiError && error.status === 503 && userFacing503(error.body) !== null) &&
  failureCount < 2;

/**
 * The `code` of a 400 body (see lib/api/refusal-codes.ts), or null: not an
 * ApiError, not a 400, or a 400 that carries no code.
 */
const refusalCode = (error: unknown): string | null => {
  if (!(error instanceof ApiError) || error.status !== 400 || !error.body) return null;
  try {
    const { code } = JSON.parse(error.body) as { code?: unknown };
    return typeof code === 'string' ? code : null;
  } catch {
    return null;
  }
};

/**
 * True when the server refused a FILTER it will not answer (a 400 coded
 * `filter_refused`). Asking again sends the same URL and gets the same answer,
 * so a list page points at the way out -- the chip row -- rather than a Retry.
 * Other 400s (a page too deep to serve, a removed parameter) are not this: the
 * reader may have no filter to remove.
 */
export const isFilterRefusal = (error: unknown): boolean =>
  refusalCode(error) === FILTER_REFUSED_CODE;

/**
 * True when the server refused a page past the result window (a 400 coded
 * `deep_page`). The filters may be fine; the pager is the way out.
 */
export const isDeepPageRefusal = (error: unknown): boolean =>
  refusalCode(error) === DEEP_PAGE_CODE;

type FetchOptions = RequestInit & { signal?: AbortSignal };

// `message` before `error`: routes put the specific sentence in `message`. Only 4xx bodies are
// shown; a 5xx body can carry Prisma SQL and bound values, so it gets a fixed sentence. Capped
// either way, since a proxy's HTML error page would overflow a phone layout.
const MAX_ERROR_MESSAGE = 400;

const cap = (text: string): string =>
  text.length <= MAX_ERROR_MESSAGE ? text : `${text.slice(0, MAX_ERROR_MESSAGE - 1).trimEnd()}…`;

const referenceFromBody = (body: string | undefined): string | null => {
  if (!body) return null;
  try {
    const { reference } = JSON.parse(body) as { reference?: unknown };
    return isErrorReference(reference) ? reference : null;
  } catch {
    return null;
  }
};

/**
 * A 503 the server wrote for the reader: "temporarily unavailable, and why". Shown
 * only when the body says so with `userFacing: true`, so a 503 carrying an
 * exception's text stays as hidden as any other 5xx.
 */
const userFacing503 = (body: string | undefined): string | null => {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as { userFacing?: unknown; error?: unknown };
    return parsed.userFacing === true && typeof parsed.error === 'string' && parsed.error.trim()
      ? cap(parsed.error.trim())
      : null;
  } catch {
    return null;
  }
};

export function errorMessageFromBody(body: string | undefined, status: number): string {
  if (status === 503) {
    const notice = userFacing503(body);
    if (notice) return notice;
  }
  // 5xx never renders the server's text, only the log reference serverError attaches.
  if (status < 400 || status >= 500) return withReference(referenceFromBody(body));
  if (body) {
    let parsed: { message?: unknown; error?: unknown } | undefined;
    try {
      parsed = JSON.parse(body) as { message?: unknown; error?: unknown };
    } catch {
      // Not JSON (an HTML error page, proxy text): show it, capped.
      if (body.trim()) return cap(body.trim());
    }
    if (parsed) {
      for (const candidate of [parsed.message, parsed.error]) {
        if (typeof candidate === 'string' && candidate.trim()) return cap(candidate.trim());
      }
      // Parsed, but carried no sentence: `{}` on screen says less than the status.
    }
  }
  return `Request failed with status ${status}`;
}

export async function apiGet<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const res = await apiFetch(url, options);

  if (!res.ok) {
    const body = await res.text().catch(() => undefined);
    throw new ApiError(res.status, errorMessageFromBody(body, res.status), body);
  }

  return res.json() as Promise<T>;
}
