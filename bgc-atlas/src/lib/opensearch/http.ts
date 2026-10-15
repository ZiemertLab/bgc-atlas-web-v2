// The one place the app reaches OpenSearch. Requests carry Basic credentials for a
// read-only user; the cluster's private CA comes from NODE_EXTRA_CA_CERTS, and
// verification is never switched off. Server-only: the guard below makes a client-side
// import fail loudly.

export const OPENSEARCH_URL = (process.env.OPENSEARCH_URL || 'http://localhost:9200').replace(/\/+$/, '');

type Env = Record<string, string | undefined>;

export function openSearchAuthHeaders(env: Env = process.env): Record<string, string> {
  const user = env.OPENSEARCH_USERNAME;
  if (!user) return {};
  const token = Buffer.from(`${user}:${env.OPENSEARCH_PASSWORD ?? ''}`).toString('base64');
  return { Authorization: `Basic ${token}` };
}

/** `path` starts with `/`; credentials are added. */
export function osRequest(path: string, init: RequestInit = {}): Promise<Response> {
  if (typeof window !== 'undefined') {
    throw new Error('osRequest is server-only');
  }
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(openSearchAuthHeaders())) headers.set(name, value);
  return fetch(`${OPENSEARCH_URL}${path}`, { ...init, headers });
}
