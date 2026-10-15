import { describe, expect, it } from 'vitest';

import {
  buildGenomeCollectionDataSourceHref,
  getGenomeCollectionsDefaultColumnVisibility,
} from './genome-collections-table';

describe('Genome Collections table configuration', () => {
  it('shows GOLD Ecosystem by default and keeps Biome and Study available but hidden', () => {
    const visibility = getGenomeCollectionsDefaultColumnVisibility();

    expect(visibility.goldEcosystem).toBe(true);
    expect(visibility.biome).toBe(false);
    expect(visibility.study).toBe(false);
  });

  it('shows the CheckM2 figures by default and keeps the MIMAG label opt-in', () => {
    const visibility = getGenomeCollectionsDefaultColumnVisibility();

    expect(visibility.completeness).toBe(true);
    expect(visibility.contamination).toBe(true);
    expect(visibility.genomeQuality).toBe(false);
  });

  it('links GTDB sources with the inline GTDB accession', () => {
    expect(
      buildGenomeCollectionDataSourceHref({
        sourceName: 'GTDB',
        sampleExternalId: 'metalog|sample-1',
        gtdbAccession: 'RS_GCF_002895405.1',
      }),
    ).toBe('https://gtdb.ecogenomic.org/genome?gid=GCF_002895405.1');
  });

  it('links non-GTDB public data sources with the sample external id', () => {
    expect(
      buildGenomeCollectionDataSourceHref({
        sourceName: 'MGnify',
        sampleExternalId: 'MGYS00000123',
        gtdbAccession: null,
        sourceUrl: null,
      }),
    ).toBe('https://www.ebi.ac.uk/metagenomics/samples/MGYS00000123');
  });

  it('uses the configured source URL when one is available', () => {
    expect(
      buildGenomeCollectionDataSourceHref({
        sourceName: 'Custom genome source',
        sampleExternalId: 'sample-1',
        gtdbAccession: null,
        sourceUrl: 'https://example.org/genomes',
      }),
    ).toBe('https://example.org/genomes');
  });
});
