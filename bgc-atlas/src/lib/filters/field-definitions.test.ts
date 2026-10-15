import { describe, expect, it } from 'vitest';

import { sampleFilterFields } from './field-definitions';
import { SOURCE_TYPES } from '@/lib/api/samples-query';

// The Advanced panel may only offer values the corpus holds. SOURCE_TYPES cannot be imported into
// the client-bundled field-definitions.ts, so the duplicate list is pinned here.
describe('sampleFilterFields sourceType options', () => {
  const sourceType = sampleFilterFields.find((f) => f.id === 'sourceType');

  it('offers exactly the source types the corpus holds', () => {
    expect(sourceType?.options?.map((o) => o.value).sort())
      .toEqual([...SOURCE_TYPES].sort());
  });

  it('labels every option, so none renders as an internal key', () => {
    // The labels are what users see; a missing one would render as undefined.
    expect(sourceType?.options?.every((o) => Boolean(o.label?.trim()))).toBe(true);
  });
});
