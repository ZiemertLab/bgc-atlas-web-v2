import { apiFetch } from '@/lib/basePath';
import { isErrorReference, withReference } from '@/lib/api/error-messages';

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
  failureCount < 2;

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

export function errorMessageFromBody(body: string | undefined, status: number): string {
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
