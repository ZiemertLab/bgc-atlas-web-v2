import { afterEach, describe, expect, it, vi } from 'vitest';

import { openSearchAuthHeaders } from './http';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('openSearchAuthHeaders', () => {
  it('is empty without a username', () => {
    expect(openSearchAuthHeaders({})).toEqual({});
    expect(openSearchAuthHeaders({ OPENSEARCH_PASSWORD: 'p' })).toEqual({});
  });

  it('encodes user:password as HTTP Basic', () => {
    const { Authorization } = openSearchAuthHeaders({ OPENSEARCH_USERNAME: 'bgc_reader', OPENSEARCH_PASSWORD: 'p:w' });
    expect(Authorization).toBe(`Basic ${Buffer.from('bgc_reader:p:w').toString('base64')}`);
  });
});

describe('osRequest', () => {
  async function load(env: Record<string, string>) {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const fetchMock = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    const { osRequest } = await import('./http');
    return { osRequest, fetchMock };
  }

  it('adds the credentials as a header, never in the URL, and keeps the caller\'s headers', async () => {
    const { osRequest, fetchMock } = await load({
      OPENSEARCH_URL: 'https://search.example:9200/',
      OPENSEARCH_USERNAME: 'bgc_reader',
      OPENSEARCH_PASSWORD: 'secret',
    });
    await osRequest('/bgc_browse/_search', { method: 'POST', headers: { 'Content-Type': 'application/json' } });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://search.example:9200/bgc_browse/_search');
    expect(url).not.toContain('secret');
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe(`Basic ${Buffer.from('bgc_reader:secret').toString('base64')}`);
    expect(headers.get('content-type')).toBe('application/json');
    expect(init.method).toBe('POST');
  });

  it('sends no Authorization header when no user is configured', async () => {
    const { osRequest, fetchMock } = await load({ OPENSEARCH_URL: 'http://localhost:9200' });
    await osRequest('/_count');
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).has('authorization')).toBe(false);
  });
});
