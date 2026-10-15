import { describe, expect, it } from 'vitest';

import { getClientIp, getClientIpOrNull } from './client-ip';

const req = (headers: Record<string, string>) => new Request('http://localhost/api/x', { headers });

describe('getClientIp', () => {
  it('prefers X-Real-IP, which nginx overwrites with the connecting address', () => {
    expect(getClientIp(req({ 'x-real-ip': '203.0.113.9', 'x-forwarded-for': '192.0.2.77, 203.0.113.9' })))
      .toBe('203.0.113.9');
  });

  it('ignores a client-forged first X-Forwarded-For entry', () => {
    // $proxy_add_x_forwarded_for appends the real address to what the client sent.
    const a = getClientIp(req({ 'x-forwarded-for': '192.0.2.77, 203.0.113.9' }));
    const b = getClientIp(req({ 'x-forwarded-for': '192.0.2.78, 203.0.113.9' }));
    expect(a).toBe('203.0.113.9');
    expect(b).toBe(a);
  });

  it('does not trust cf-connecting-ip (no Cloudflare in front of the site)', () => {
    expect(getClientIp(req({ 'cf-connecting-ip': '192.0.2.1' }))).toBe('unknown');
  });

  it('falls back to one shared bucket without proxy headers', () => {
    expect(getClientIp(req({}))).toBe('unknown');
    expect(getClientIp(req({ 'x-forwarded-for': ' , ' }))).toBe('unknown');
  });
});

describe('getClientIpOrNull', () => {
  it('returns an inet-safe address or null', () => {
    expect(getClientIpOrNull(req({ 'x-real-ip': '2001:db8::1' }))).toBe('2001:db8::1');
    expect(getClientIpOrNull(req({}))).toBeNull();
    expect(getClientIpOrNull(req({ 'x-real-ip': 'not an ip' }))).toBeNull();
  });
});
