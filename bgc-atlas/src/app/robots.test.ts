import { describe, expect, it } from 'vitest';
import robots from './robots';

const rules = robots().rules as { userAgent: string | string[]; allow?: string[] | string; disallow?: string[] | string }[];
const group = (ua: string) => rules.find((r) => [r.userAgent].flat().includes(ua))!;

describe('robots.txt', () => {
  it('keeps crawlers out of the API', () => {
    expect(group('*').disallow).toContain('/api');
  });

  it.each(['ChatGPT-User', 'Claude-User', 'Perplexity-User'])('lets %s call the API', (ua) => {
    const g = group(ua);
    expect(g.allow).toContain('/api/');
    expect(g.disallow).toContain('/*?_rsc=');
  });

  // Google's rule: of the rules whose path matches, the longest wins; on a tie,
  // allow. `*` matches any run of characters, `$` anchors the end.
  const googleAllows = (path: string) => {
    const g = group('Googlebot');
    const toRe = (rule: string) => new RegExp(
      `^${rule.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$')}`,
    );
    let best: { length: number; allow: boolean } | null = null;
    for (const [rules, allow] of [[[g.allow ?? []].flat(), true], [[g.disallow ?? []].flat(), false]] as const) {
      for (const rule of rules) {
        if (!toRe(rule).test(path)) continue;
        if (!best || rule.length > best.length || (rule.length === best.length && allow)) best = { length: rule.length, allow };
      }
    }
    return best?.allow ?? true;
  };

  it.each([
    '/gcfs/51799eb7-32e7-5596-b5da-c0f980df67e0',
    '/api/gcfs/51799eb7-32e7-5596-b5da-c0f980df67e0',
    '/api/studies/6cc95fce-50b5-5468-a9c8-0a3192e1318d',
    '/api/studies/gcf-counts?study=X&gcfs=a,b',
    '/api/bgcs/64e3a186-d396-5575-850f-140070a8a93a',
    '/api/gcfs?study=Microflora&exclusive=1&limit=50',
    '/api/samples?studyKey=Microflora&limit=25',
  ])('lets Googlebot fetch %s', (path) => {
    expect(googleAllows(path)).toBe(true);
  });

  it.each([
    '/api/gcfs/51799eb7-32e7-5596-b5da-c0f980df67e0/environment',
    '/api/gcfs/51799eb7-32e7-5596-b5da-c0f980df67e0/samples/map',
    '/api/gcfs/51799eb7-32e7-5596-b5da-c0f980df67e0/taxonomy-distribution',
    '/api/bgcs/64e3a186-d396-5575-850f-140070a8a93a/antismash-json',
    '/api/bgcs/64e3a186-d396-5575-850f-140070a8a93a/download?format=gbk',
    '/api/bgcs/export?format=csv',
    '/api/gcfs?limit=50',
    '/api/bgcs?limit=50',
    '/api/samples?limit=50',
    '/api/analytics/track-page-view',
    '/api/admin/jobs/status',
    '/admin',
    '/gcfs?_rsc=abc',
  ])('keeps Googlebot off %s', (path) => {
    expect(googleAllows(path)).toBe(false);
  });

  it('leaves every other crawler out of the API', () => {
    expect(group('*').allow).toBe('/');
    expect(group('*').disallow).toContain('/api');
  });
});
