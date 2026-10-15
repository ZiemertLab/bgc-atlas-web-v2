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
});
