import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryRaw, bgcFacetDocs, hydrateGcfNames } = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  bgcFacetDocs: vi.fn(),
  hydrateGcfNames: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ default: { $queryRaw: queryRaw } }));
vi.mock('@/lib/opensearch/client', () => ({ bgcFacetDocs }));
vi.mock('@/lib/opensearch/hydrate', () => ({ hydrateGcfNames }));

import { facetDocToHydrated, hydrateBgcs } from './hydrate';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const GCF = '00000000-0000-4000-8000-0000000000ff';

const DOC = {
  filename: 'RS_GCF_005886225.1_NZ_PNEF01000009.1.region001',
  contig: 'NZ_PNEF01000009.1',
  product_type: ['NRPS'],
  product_category: ['NRPS'],
  sample_id: 'fc8a8d59-98d5-5564-9991-813059673167',
  sample_name: 'RS_GCF_005886225.1',
  data_source: 'gtdb_genomes_antismash_runs',
  gcf_id: GCF,
  tax_domain: 'd__Bacteria',
  tax_phylum: 'p__Pseudomonadota',
  tax_class: 'c__Gammaproteobacteria',
  tax_order: 'o__Enterobacterales',
  tax_family: 'f__Alteromonadaceae',
  tax_genus: 'g__Pseudoalteromonas',
  tax_species: 's__Pseudoalteromonas piscicida',
};

function sqlRow(id: string) {
  return {
    bgc_id: id, bgc_filename: 'f', contig: 'c', product: ['terpene'], product_category: ['terpene'],
    sample_id: null, sample_name: null, data_source: 'GTDB', gcf_id: null, gcf_name: null,
    taxon_name: null, taxon_lineage: null,
  };
}

beforeEach(() => {
  queryRaw.mockReset();
  bgcFacetDocs.mockReset();
  hydrateGcfNames.mockReset().mockResolvedValue({ [GCF]: 'GCF40_93468' });
});

describe('facetDocToHydrated', () => {
  it('maps an index document to the join shape, with the curated data-source label', () => {
    expect(facetDocToHydrated(A, DOC)).toEqual({
      bgcId: A,
      bgcFilename: DOC.filename,
      contig: DOC.contig,
      products: ['NRPS'],
      categories: ['NRPS'],
      sampleId: DOC.sample_id,
      sampleName: DOC.sample_name,
      dataSource: 'GTDB HQ Genomes',
      gcfId: GCF,
      gcfName: null,
      taxonName: 's__Pseudoalteromonas piscicida',
      taxonLineage: 'd__Bacteria;p__Pseudomonadota;c__Gammaproteobacteria;o__Enterobacterales;'
        + 'f__Alteromonadaceae;g__Pseudoalteromonas;s__Pseudoalteromonas piscicida',
    });
  });

  it('stops the lineage at the deepest assigned rank, as gtdb_lineage does', () => {
    const bgc = facetDocToHydrated(A, { tax_domain: 'd__Bacteria', tax_phylum: 'p__Actinomycetota', tax_class: null });
    expect(bgc.taxonName).toBe('p__Actinomycetota');
    expect(bgc.taxonLineage).toBe('d__Bacteria;p__Actinomycetota');
  });

  it('leaves taxonomy null when no rank is assigned, and passes an unknown source key through', () => {
    const bgc = facetDocToHydrated(A, { data_source: 'some_new_runs' });
    expect(bgc.taxonName).toBeNull();
    expect(bgc.taxonLineage).toBeNull();
    expect(bgc.dataSource).toBe('some_new_runs');
    expect(bgc.products).toEqual([]);
  });
});

describe('hydrateBgcs', () => {
  it('answers from the index without touching Postgres, and names the family', async () => {
    bgcFacetDocs.mockResolvedValue(new Map([[A, DOC]]));
    const out = await hydrateBgcs([A, A, 'not-a-uuid']);
    expect(bgcFacetDocs).toHaveBeenCalledWith([A], expect.any(Array));
    expect(queryRaw).not.toHaveBeenCalled();
    expect(out[A].gcfName).toBe('GCF40_93468');
  });

  it('sends only the ids the index lacks to Postgres', async () => {
    bgcFacetDocs.mockResolvedValue(new Map([[A, DOC]]));
    queryRaw.mockResolvedValue([sqlRow(B)]);
    const out = await hydrateBgcs([A, B]);
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(queryRaw.mock.calls[0][0].values).toEqual([[B]]);
    expect(Object.keys(out).sort()).toEqual([A, B]);
    expect(out[B].dataSource).toBe('GTDB');
  });

  it('falls back to Postgres for everything when OpenSearch fails', async () => {
    bgcFacetDocs.mockRejectedValue(new Error('OpenSearch 503'));
    queryRaw.mockResolvedValue([sqlRow(A), sqlRow(B)]);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await hydrateBgcs([A, B]);
    expect(queryRaw.mock.calls[0][0].values).toEqual([[A, B]]);
    expect(Object.keys(out).sort()).toEqual([A, B]);
  });

  it('does no lookups for an empty or invalid id list', async () => {
    expect(await hydrateBgcs(['nope'])).toEqual({});
    expect(bgcFacetDocs).not.toHaveBeenCalled();
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
