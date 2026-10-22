import { describe, expect, it } from 'vitest';

import {
  createDefaultFilterGroup, createFilterCondition, decodeBase64, deserializeFilterGroup, encodeBase64,
  serializeFilterGroup,
} from './types';
import { advancedFilterRequestParam, unreadableAdvancedFilterParam } from './advanced-filter-param';
import { mergeQuery, nextUrl } from '@/lib/url-state';

describe('encodeBase64 / decodeBase64', () => {
  it('is byte-identical to the old btoa for ASCII, so existing links and cache keys hold', () => {
    const json = JSON.stringify({ field: 'product', operator: 'in', value: ['NRPS', 'lassopeptide'] });
    expect(encodeBase64(json)).toBe(btoa(json));
  });

  it.each(['α-proteobacteria', '≥ 50', 'NRPS – PKS', '66.5°', 'µm', '中文'])('round-trips %s', (text) => {
    expect(decodeBase64(encodeBase64(text))).toBe(text);
  });

  it('still reads a link written by the old Latin-1 encoder', () => {
    // btoa('66.5°') -- one byte for the degree sign, which is not valid UTF-8.
    expect(decodeBase64(btoa('66.5°'))).toBe('66.5°');
    expect(decodeBase64(btoa('µm, café'))).toBe('µm, café');
  });

  it('reads a UTF-8 payload built outside the browser (Python base64 of UTF-8 JSON)', () => {
    expect(decodeBase64(Buffer.from('≥ α', 'utf-8').toString('base64'))).toBe('≥ α');
  });
});

describe('serializeFilterGroup', () => {
  it('keeps a filter whose value is outside Latin-1 instead of dropping it', () => {
    // The bug: btoa threw on 'α', serializeFilterGroup returned '', and the request
    // went out with no advanced filter -- the whole corpus at HTTP 200.
    const group = {
      ...createDefaultFilterGroup(),
      conditions: [createFilterCondition('taxonomy', 'contains', 'α-proteobacteria' as never)],
    };
    const encoded = serializeFilterGroup(group);
    expect(encoded).not.toBe('');
    expect(deserializeFilterGroup(encoded)?.conditions[0].value).toBe('α-proteobacteria');
  });
});

describe('advancedFilters through the URL: encoded exactly once', () => {
  // A payload whose base64 ends in '=' (and holds '+' / '/'), the case the e2e
  // caught being rewritten from %3D%3D to %253D%253D on load.
  const groupEndingInPadding = () => {
    for (let n = 1; n < 40; n += 1) {
      const group = {
        ...createDefaultFilterGroup(),
        conditions: [createFilterCondition('taxonomy', 'contains', `${'x'.repeat(n)}?>~` as never)],
      };
      const b64 = serializeFilterGroup(group);
      if (b64.endsWith('==') && /[+/]/.test(b64)) return { group, b64 };
    }
    throw new Error('no padded payload found');
  };

  it('serializes to raw base64, not a URI-encoded fragment', () => {
    const { b64 } = groupEndingInPadding();
    expect(b64).not.toMatch(/%/);
    expect(b64.endsWith('==')).toBe(true);
  });

  it('round-trips serialize -> mergeQuery -> URLSearchParams -> get -> deserialize', () => {
    const { group, b64 } = groupEndingInPadding();
    const query = mergeQuery('search=x', [['advancedFilters', b64]]);
    expect(query).toContain('%3D%3D');
    expect(query).not.toContain('%25');
    const read = new URLSearchParams(query).get('advancedFilters');
    expect(read).toBe(b64);
    expect(deserializeFilterGroup(read)?.conditions[0].value).toBe(group.conditions[0].value);
  });

  it('does not rewrite a canonical link (mirror loop guard sees no change)', () => {
    const { b64 } = groupEndingInPadding();
    const canonical = new URLSearchParams({ advancedFilters: b64, search: 'x' }).toString();
    const fromLink = new URLSearchParams(canonical).get('advancedFilters') ?? '';
    const reserialized = serializeFilterGroup(deserializeFilterGroup(fromLink));
    expect(nextUrl('/gcfs', canonical, [['advancedFilters', reserialized]])).toBeNull();
  });

  it('still parses a legacy link that was encoded twice (%253D%253D)', () => {
    const { group, b64 } = groupEndingInPadding();
    const legacyQuery = `advancedFilters=${encodeURIComponent(encodeURIComponent(b64))}`;
    expect(legacyQuery).toContain('%253D%253D');
    const read = new URLSearchParams(legacyQuery).get('advancedFilters');
    expect(deserializeFilterGroup(read)?.conditions[0].value).toBe(group.conditions[0].value);
    // ...and the old serializer's own output, handed over directly.
    expect(deserializeFilterGroup(encodeURIComponent(b64))?.conditions[0].value)
      .toBe(group.conditions[0].value);
  });

  it('reads a hand-built link that left "+" unescaped', () => {
    const { group, b64 } = groupEndingInPadding();
    const read = new URLSearchParams(`advancedFilters=${b64}`).get('advancedFilters');
    expect(deserializeFilterGroup(read)?.conditions[0].value).toBe(group.conditions[0].value);
  });

  it('forwards an unreadable value verbatim, and the mirror writes it back unchanged', () => {
    const arrived = 'advancedFilters=eyJjb25kaXRpb25z%25zz';
    const raw = new URLSearchParams(arrived).get('advancedFilters');
    expect(deserializeFilterGroup(raw)).toBeNull();
    const forwarded = unreadableAdvancedFilterParam(raw);
    expect(forwarded).toBe(raw);
    expect(nextUrl('/gcfs', arrived, [['advancedFilters', advancedFilterRequestParam('', forwarded) ?? '']])).toBeNull();
  });
});
