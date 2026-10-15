import { describe, it, expect } from 'vitest';
import {
  GCF_EXPORT_COLUMNS, SAMPLE_EXPORT_COLUMNS, entityExportColumns,
  toGcfExportRow, toSampleExportRow,
} from '@/lib/opensearch/entity-export-columns';
import { serializeDelimited } from '@/lib/opensearch/export-columns';

const gcfDoc = {
  gcf_name: 'GCF-04-000042',
  pet_name: 'amber otter',
  member_bgc_count: 240,
  complete_bgc_count: 0,
  partial_bgc_count: 240,
  assembly_count: 198,
  max_len: 28_800,
  min_len: 4_100,
  median_complete_len: null,
  product_category_distribution: { NRPS: 60, PKS: 40 },
  taxonomy_distributions: {
    phylum: { p__Bacillota: 90, p__Pseudomonadota: 10 },
    // The real shape: most members carry no genus assignment.
    genus: { g__Unknown: 84.24, g__RUG131: 2.33, g__Faecalibacterium: 1.17 },
  },
  avg_distance: 0.1930478828525147,
  // Real L1 keys: already labels, and one of them is a synthetic bucket,
  // which shares a prefix with `Host-associated`.
  biome_distribution_l1: { Environmental: 75, 'Host-assoc.: Plants': 25 },
};

describe('GCF export rows', () => {
  it('carries the ≥ bound when no member is complete', () => {
    // A family with no complete member reports its longest member: a floor.
    expect(toGcfExportRow({ id: 'a', bgcCount: 12, source: gcfDoc }).bgc_length).toBe('≥28.8 kb');
  });

  it('strips the GTDB rank prefix from taxa', () => {
    expect(toGcfExportRow({ id: 'a', bgcCount: 12, source: gcfDoc }).top_phylum)
      .toBe('Bacillota 90%');
  });

  it('never names Unknown as the top taxon, but keeps it in the denominator', () => {
    // `*__Unknown` is not a taxon: 2.33 of 87.74 is 3%, not 2.33 of 3.5 (67%).
    expect(toGcfExportRow({ id: 'a', bgcCount: 12, source: gcfDoc }).top_genus)
      .toBe('RUG131 3%');
  });

  it('exports nothing when every member is unassigned at that rank', () => {
    expect(toGcfExportRow({
      id: 'a', bgcCount: 1, source: { taxonomy_distributions: { genus: { g__Unknown: 100 } } },
    }).top_genus).toBe('');
  });

  it('rounds the distance the way the Avg Distance column does', () => {
    expect(toGcfExportRow({ id: 'a', bgcCount: 1, source: gcfDoc }).avg_distance).toBe('0.193');
  });

  it('drops a distribution member that rounds to 0%', () => {
    expect(toGcfExportRow({
      id: 'a', bgcCount: 1, source: { product_category_distribution: { RiPP: 99.6, other: 0.4 } },
    }).product_category_distribution).toBe('RiPP 100%');
  });

  it('keeps L1 biome keys verbatim so the Plants bucket stays distinct', () => {
    expect(toGcfExportRow({ id: 'a', bgcCount: 12, source: gcfDoc }).biome_l1)
      .toBe('Environmental 75%; Host-assoc.: Plants 25%');
  });

  it('takes each distribution share over its OWN sum', () => {
    // Biome L1 sums to 40 while the family has 240 members: the level's own tally is the denominator.
    const row = toGcfExportRow({ id: 'a', bgcCount: 12, source: gcfDoc });
    expect(row.product_category_distribution).toBe('NRPS 60%; PKS 40%');
  });

  it('exports an absent distribution as empty, not as 0%', () => {
    const row = toGcfExportRow({ id: 'a', bgcCount: 1, source: {} });
    expect(row.top_genus).toBe('');
    expect(row.biome_l1).toBe('');
    expect(row.bgc_length).toBe('');
  });

  it('names an unhydrated family from its id rather than leaving it blank', () => {
    expect(toGcfExportRow({ id: '1a2b3c4d-0000', bgcCount: 1, source: {} }).gcf_name)
      .toBe('GCF_1a2b3c4d');
  });

  it('adds one column per cohort, beside the count they explain', () => {
    const columns = entityExportColumns('gcfs', ['Arctic', 'Antarctic']);
    const keys = columns.map((c) => c.key);
    expect(keys.slice(keys.indexOf('matching_bgcs') + 1, keys.indexOf('member_bgcs'))).toEqual(
      ['cohort_0', 'cohort_1', 'inside', 'located', 'purity']);
    expect(columns.find((c) => c.key === 'cohort_0')?.label).toBe('In: Arctic');
  });

  it('leaves the scope columns out when the query is not scoped', () => {
    expect(entityExportColumns('gcfs')).toEqual(GCF_EXPORT_COLUMNS);
    expect(entityExportColumns('samples', ['Arctic'])).toEqual(SAMPLE_EXPORT_COLUMNS);
  });

  it('writes exclusivity as a percentage', () => {
    const row = toGcfExportRow({
      id: 'a', bgcCount: 5, source: gcfDoc,
      cohortCounts: [3, 2], inside: 5, located: 6, members: 240, purity: 5 / 6,
    });
    expect([row.cohort_0, row.cohort_1, row.inside, row.located, row.purity])
      .toEqual([3, 2, 5, 6, '83%']);
  });
});

describe('sample export rows', () => {
  it('keeps clustered and unclustered beside the GCF count', () => {
    const row = toSampleExportRow({
      id: 's1', bgcCount: 4,
      source: { name: 'SRS123', bgc_count: 40, gcf_count: 12, clustered_bgc_count: 21, unclustered_bgc_count: 19 },
    });
    expect([row.gcfs, row.clustered_bgcs, row.unclustered_bgcs]).toEqual([12, 21, 19]);
  });

  it('distinguishes an absent count from a real zero', () => {
    const row = toSampleExportRow({ id: 's1', bgcCount: 1, source: {} });
    expect(row.gcfs).toBe('');
    expect(row.total_bgcs).toBe(0);
  });

  it('treats a bare root path as no biome, as the Biome column does', () => {
    expect(toSampleExportRow({ id: 's1', bgcCount: 1, source: { primary_biome: 'root' } }).biome)
      .toBe('');
    expect(toSampleExportRow({
      id: 's1', bgcCount: 1, source: { primary_biome: 'root:Environmental:Aquatic:Marine' },
    }).biome).toBe('Environmental');
  });
});

describe('serialization', () => {
  it('quotes a delimiter inside a value', () => {
    const rows = [toSampleExportRow({
      id: 's1', bgcCount: 1,
      source: { study_titles: ['Soil microbiome, Denmark'] },
    })];
    const csv = serializeDelimited(rows, entityExportColumns('samples'), ',');
    expect(csv.split('\n')[1]).toContain('"Soil microbiome, Denmark"');
  });

  it('joins an array column with semicolons', () => {
    const rows = [toGcfExportRow({
      id: 'a', bgcCount: 1, source: { ...gcfDoc, mibig_compounds: ['erythromycin', 'pikromycin'] },
    })];
    const tsv = serializeDelimited(rows, entityExportColumns('gcfs'), '\t');
    expect(tsv).toContain('erythromycin; pikromycin');
  });
});
