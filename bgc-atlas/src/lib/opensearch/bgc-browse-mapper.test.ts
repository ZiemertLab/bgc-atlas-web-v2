import { describe, expect, it } from 'vitest';
import { mapBgcBrowseDocument } from './bgc-browse-mapper';

describe('mapBgcBrowseDocument', () => {
  it('maps a denormalized browse document to the existing BGC response shape', () => {
    expect(mapBgcBrowseDocument({
      bgc_id: 'b1', filename: 'run.region001', assembly_id: 'a1',
      product_category: ['NRPS'], product_type: ['NRPS'], is_complete: true,
      length: 1234, num_cds_features: 4, gcf_id: 'g1', distance: 0.125,
      sample_ids: ['s1'], sample_labels: ['source: sample one'], data_source_names: ['MGnify'],
      tax_genus: 'Streptomyces',
    })).toMatchObject({
      id: 'b1', name: 'run.region001', category: 'NRPS', categories: ['NRPS'],
      products: ['NRPS'], completeness: 'complete',
      length: 1234, distance: 0.125, sampleIds: ['s1'], dataSourceNames: ['MGnify'],
      taxonomyGenus: 'Streptomyces',
    });
  });
});
