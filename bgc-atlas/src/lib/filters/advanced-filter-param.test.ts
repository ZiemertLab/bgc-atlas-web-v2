import { describe, it, expect } from 'vitest';
import {
  advancedFilterRequestParam,
  unreadableAdvancedFilterParam,
} from '@/lib/filters/advanced-filter-param';
import { serializeFilterGroup, type FilterGroup } from '@/lib/filters/types';

const group: FilterGroup = {
  id: 'g', operator: 'AND', groups: [],
  conditions: [{ id: 'c1', field: 'bgcs', operator: 'gt', value: 10 }],
};
const good = serializeFilterGroup(group);

// Browse pages rebuild requests from state, so an unparseable URL value used to reach the server
// as no filter at all and answer the whole corpus.
describe('unreadableAdvancedFilterParam', () => {
  it('reports a truncated payload, which is how a mangled link arrives', () => {
    const truncated = good.slice(0, Math.floor(good.length * 0.6));
    expect(unreadableAdvancedFilterParam(truncated)).toBe(truncated);
  });

  it('reports valid base64 that is not a filter group', () => {
    const notAGroup = Buffer.from(JSON.stringify({ hello: 1 })).toString('base64');
    expect(unreadableAdvancedFilterParam(notAGroup)).toBe(notAGroup);
    const wrongShape = Buffer.from(
      JSON.stringify({ id: 'g', operator: 'AND', conditions: 'nope', groups: [] }),
    ).toString('base64');
    expect(unreadableAdvancedFilterParam(wrongShape)).toBe(wrongShape);
  });

  it('reports nothing for a readable payload', () => {
    expect(unreadableAdvancedFilterParam(good)).toBeNull();
  });

  it('reports nothing for an absent one — absent is not unreadable', () => {
    expect(unreadableAdvancedFilterParam(null)).toBeNull();
    expect(unreadableAdvancedFilterParam(undefined)).toBeNull();
    expect(unreadableAdvancedFilterParam('')).toBeNull();
    expect(unreadableAdvancedFilterParam('   ')).toBeNull();
  });
});

describe('advancedFilterRequestParam', () => {
  it('forwards the unreadable value so the SERVER decides, not the page', () => {
    expect(advancedFilterRequestParam('', 'mangled')).toBe('mangled');
  });

  it('prefers the page state, so applying or clearing a filter wins', () => {
    expect(advancedFilterRequestParam(good, 'mangled')).toBe(good);
    expect(advancedFilterRequestParam('', null)).toBeUndefined();
  });

  it('sends nothing when there is nothing to send', () => {
    expect(advancedFilterRequestParam('', null)).toBeUndefined();
  });
});
