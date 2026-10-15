import { describe, it, expect } from 'vitest';
import { bucketLink } from '@/lib/utils/bucket-links';

describe('bucketLink — GCF', () => {
  const uuid = 'fd788842-04ff-50e9-8fca-bc46a6ef0c9e';

  it('links a GCF bucket to its Atlas page, titled with the display name', () => {
    expect(bucketLink('gcf_id', uuid, 'GCF-04-000042')).toEqual({
      href: `/gcfs/${uuid}`,
      external: false,
      kind: 'gcf',
      title: 'Open GCF-04-000042 in the Atlas',
    });
  });

  it('refuses a gcf_id value that is not a uuid', () => {
    expect(bucketLink('gcf_id', 'GCF-04-000042')).toBeNull();
  });
});

describe('bucketLink — MIBiG', () => {
  it('keeps the version suffix, which MIBiG 4.x requires', () => {
    expect(bucketLink('knowncluster_hits', 'BGC0001758.4')?.href)
      .toBe('https://mibig.secondarymetabolites.org/repository/BGC0001758.4/');
  });

  it('covers every MIBiG-bearing facet', () => {
    for (const field of ['knowncluster_hits', 'mibig_comparison_top', 'comparippson_hits']) {
      expect(bucketLink(field, 'BGC0000838.3')?.kind).toBe('mibig');
    }
  });

  it('leaves an unversioned accession unlinked rather than pointing at a 404', () => {
    expect(bucketLink('knowncluster_hits', 'BGC0001758')).toBeNull();
  });
});

describe('bucketLink — NCBI', () => {
  it('links GenBank and RefSeq accessions', () => {
    expect(bucketLink('subcluster_hits', 'DQ230532')?.href)
      .toBe('https://www.ncbi.nlm.nih.gov/nuccore/DQ230532');
    expect(bucketLink('clusterblast_hits', 'NZ_JADMNS010000001')?.kind).toBe('ncbi');
  });

  it('routes each CompaRiPPson value by its own shape', () => {
    expect(bucketLink('comparippson_hits', 'NZ_KZ819178.1')?.kind).toBe('ncbi');
    expect(bucketLink('comparippson_hits', 'BGC0001229.4')?.kind).toBe('mibig');
  });

  it('never sends a BGC accession to NCBI', () => {
    expect(bucketLink('clusterblast_hits', 'BGC0001229.4')).toBeNull();
    expect(bucketLink('clusterblast_hits', 'BGC0001229')).toBeNull();
  });
});

describe('bucketLink — GTDB taxonomy', () => {
  it('strips the rank prefix before searching', () => {
    expect(bucketLink('tax_species', 's__Pseudomonas aeruginosa')).toEqual({
      href: 'https://gtdb.ecogenomic.org/searches?s=al&q=Pseudomonas%20aeruginosa',
      external: true,
      kind: 'gtdb',
      title: 'Pseudomonas aeruginosa in GTDB',
    });
  });

  it('applies to every rank', () => {
    for (const field of ['tax_domain', 'tax_phylum', 'tax_class', 'tax_order', 'tax_family', 'tax_genus']) {
      expect(bucketLink(field, 'p__Pseudomonadota')?.kind).toBe('gtdb');
    }
  });

  it('ignores a bare rank prefix with no name', () => {
    expect(bucketLink('tax_genus', 'g__')).toBeNull();
  });
});

describe('bucketLink — fields with no target', () => {
  it('leaves non-identifier facets alone', () => {
    for (const field of ['product', 'biome', 'gold_ecosystem', 'sample_name', 'smcog', 'pfam']) {
      expect(bucketLink(field, 'anything')).toBeNull();
    }
  });

  it('handles empty and malformed values', () => {
    expect(bucketLink('gcf_id', '')).toBeNull();
    expect(bucketLink('gcf_id', '   ')).toBeNull();
    expect(bucketLink('unknown_field', 'BGC0001758.4')).toBeNull();
  });
});
