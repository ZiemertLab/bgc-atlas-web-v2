import { describe, it, expect } from 'vitest';
import { unhonourableQueryMessage, UnhonourableQueryError } from '@/lib/filters/unhonourable-query';
import type { UnhonouredCondition } from '@/lib/filters/types';

const unsupported: UnhonouredCondition = {
  field: 'is_complete', operator: 'in', reason: 'unsupported_operator',
  value: ['true'], supportedOperators: ['equals', 'not_equals'],
};
const unknown: UnhonouredCondition = {
  field: 'is_complte', operator: 'equals', reason: 'unknown_field', value: 'true',
};

describe('unhonourableQueryMessage', () => {
  it('names the field, the operator and what the field does support', () => {
    const msg = unhonourableQueryMessage([unsupported]);
    expect(msg).toContain('"is_complete"');
    expect(msg).toContain('"in"');
    expect(msg).toContain('supported: equals, not_equals');
    expect(msg).toContain('that condition');
    expect(msg).toContain('broader question');
  });

  it('lists every offending item, not just the first', () => {
    const msg = unhonourableQueryMessage([unsupported, unknown], ['length']);
    expect(msg).toContain('is_complete');
    expect(msg).toContain('is_complte');
    expect(msg).toContain('"length"');
    expect(msg).toContain('those conditions');
  });

  it('does not tell a facet-field rejection it would have widened the answer', () => {
    const msg = unhonourableQueryMessage([], ['length']);
    expect(msg).toContain('facet field "length" cannot be aggregated');
    expect(msg).toContain('keyword and boolean');
    expect(msg).not.toContain('broader question');
    expect(msg).not.toContain('condition');
  });

  it('carries the specifics on the error as well as in the text', () => {
    const err = new UnhonourableQueryError([unsupported], ['length']);
    expect(err.message).toBe(unhonourableQueryMessage([unsupported], ['length']));
    expect(err.conditions).toEqual([unsupported]);
    expect(err.facetFields).toEqual(['length']);
  });
});
