import { describe, expect, it } from 'vitest';
import { isBrowseSearchEnabled, parseBrowseSearchResponse } from './browse-client';

describe('browse-client', () => {
  it('returns source documents and an exact total from OpenSearch hits', () => {
    expect(parseBrowseSearchResponse({
      hits: {
        total: { value: 2 },
        hits: [{ _source: { sample_id: 's1' } }, { _source: { sample_id: 's2' } }],
      },
    })).toEqual({ total: 2, documents: [{ sample_id: 's1' }, { sample_id: 's2' }] });
  });

  it('keeps all browse indexes disabled unless explicitly enabled', () => {
    expect(isBrowseSearchEnabled('samples', {})).toBe(false);
    expect(isBrowseSearchEnabled('samples', { OPENSEARCH_BROWSE_SAMPLES_ENABLED: 'true' })).toBe(true);
    expect(isBrowseSearchEnabled('samples', { OPENSEARCH_BROWSE_ENABLED: 'false' })).toBe(false);
  });
});
