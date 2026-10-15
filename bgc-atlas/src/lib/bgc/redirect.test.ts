import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: {} }));

import { redirectToTwin } from './redirect';

describe('redirectToTwin', () => {
  it('sends a host-relative Location, so a proxied upstream host never leaks', () => {
    const res = redirectToTwin(new URL('https://localhost:3001/api/bgcs/abc/download?format=gbk'));
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('/api/bgcs/abc/download?format=gbk');
  });

  it('says why in the body and points at the full mapping, never at localhost', async () => {
    const body = await redirectToTwin(new URL('https://localhost:3001/api/bgcs/abc')).json();
    expect(body.redirect).toBe('/api/bgcs/abc');
    expect(body.reason).toContain('https://bgc-atlas.cs.uni-tuebingen.de/downloads/bgc_id_redirects.tsv.gz');
    expect(JSON.stringify(body)).not.toContain('localhost');
  });
});
