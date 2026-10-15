import { describe, expect, it } from 'vitest';

import { DATA_SOURCE_EXPANSION, DATA_SOURCE_OPTIONS } from './data-sources';
import { formatDataSourceName, getDataSourceUrl } from '@/lib/utils/data-source-name';

describe('OMDB naming', () => {
  it('offers OMDB, not the retired OMD-v2 label', () => {
    const labels = DATA_SOURCE_OPTIONS.map((o) => o.label);
    expect(labels).toContain('OMDB');
    expect(labels).not.toContain('OMD-v2');
  });

  it('keeps a saved query that names OMD-v2 matching the same genomes', () => {
    // An unknown label is passed through as a raw value and matches nothing.
    expect(DATA_SOURCE_EXPANSION['OMD-v2']).toEqual(DATA_SOURCE_EXPANSION.OMDB);
    expect(DATA_SOURCE_EXPANSION.OMDB).toEqual(['omd-v2']);
  });

  it('displays the stored name as OMDB and links its current home', () => {
    expect(formatDataSourceName('Ocean Microbiomics Database v2')).toBe('OMDB');
    expect(getDataSourceUrl('Ocean Microbiomics Database v2')).toBe('https://omdb.microbiomics.io/');
    expect(formatDataSourceName('GTDB')).toBe('GTDB');
  });
});
