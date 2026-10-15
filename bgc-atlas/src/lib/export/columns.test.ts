import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

import { BGC_EXPORT_COLUMNS, type ExportableBgc } from './bgc-columns';
import { GCF_TABLE_EXPORT_COLUMNS, formatShares } from './gcf-columns';
import { GENOME_EXPORT_COLUMNS, METAGENOME_EXPORT_COLUMNS } from './sample-columns';
import { STUDY_EXPORT_COLUMNS } from './study-columns';
import type { ExportColumn } from './format';
import type { GcfListItem } from '@/lib/hooks/use-gcfs';
import type { Sample, Study } from '@/lib/types';

// A table that gains a column must gain an export column. Ids are read from source because the
// column builders are hooks.
const columnIds = (file: string, indent = 6): string[] => {
  const src = readFileSync(resolve(__dirname, file), 'utf8');
  return [...src.matchAll(new RegExp(`^ {${indent}}id: '(\\w+)',$`, 'gm'))].map((m) => m[1]);
};

/** Table column id -> the export ids that carry it. A column with a header
 *  control (rank, level) exports as one column per choice. */
const covered = (columns: ExportColumn<unknown>[], tableId: string, aliases: Record<string, string> = {}) => {
  const target = aliases[tableId] ?? tableId;
  return columns.some((c) => c.id === target || c.id.startsWith(`${target}_`));
};

const uncovered = (ids: string[], columns: ExportColumn<never>[], aliases: Record<string, string> = {}) =>
  ids.filter((id) => !covered(columns as ExportColumn<unknown>[], id, aliases));

describe('every table column has an export column', () => {
  it.each([
    ['the /bgcs page', '../../app/bgcs/page.tsx'],
    ['the BgcTable component', '../../components/tables/bgc-table/bgc-table-columns.tsx'],
  ])('BGCs: %s', (_label, file) => {
    const ids = columnIds(file);
    expect(ids.length).toBeGreaterThan(10);
    expect(uncovered(ids, BGC_EXPORT_COLUMNS)).toEqual([]);
  });

  it('/gcfs', () => {
    const ids = columnIds('../../app/gcfs/page.tsx');
    expect(ids.length).toBeGreaterThan(10);
    expect(uncovered(ids, GCF_TABLE_EXPORT_COLUMNS, {
      taxonomyDistribution: 'taxonomy',
      biomeDistribution: 'biomeDistribution',
    })).toEqual([]);
  });

  it('/samples', () => {
    const ids = columnIds('../../app/samples/page.tsx');
    expect(ids.length).toBeGreaterThan(10);
    expect(uncovered(ids, METAGENOME_EXPORT_COLUMNS)).toEqual([]);
  });

  it('/genome-collections', () => {
    const ids = columnIds('../../app/genome-collections/page.tsx');
    expect(ids.length).toBeGreaterThan(7);
    expect(uncovered(ids, GENOME_EXPORT_COLUMNS)).toEqual([]);
  });

  it('/studies', () => {
    const ids = columnIds('../../app/studies/page.tsx', 8);
    expect(ids.length).toBeGreaterThan(5);
    expect(uncovered(ids, STUDY_EXPORT_COLUMNS, {
      total: 'total_bgcs',
      distinct: 'distinct_gcfs',
      exclusive: 'exclusive_gcfs',
      products: 'category_assignments',
      environment: 'gold_ecosystem',
      complete: 'complete_bgcs',
      coverage: 'gcf_coverage',
      datasetType: 'bgcs_by_dataset_type',
      source: 'sources',
    })).toEqual([]);
  });
});

describe('columns that expand a header control', () => {
  const bgc = {
    id: 'b1', taxonomyDomain: 'd__Bacteria', taxonomyPhylum: 'p__Actinomycetota',
    taxonomyClass: null, taxonomyOrder: null, taxonomyFamily: null,
    taxonomyGenus: 'g__Streptomyces', taxonomySpecies: null,
  } as unknown as ExportableBgc;

  it('BGC taxonomy: one column per rank, blank where the rank is unresolved', () => {
    const value = (rank: string) => BGC_EXPORT_COLUMNS.find((c) => c.id === `taxonomy_${rank}`)!.value(bgc);
    expect(value('phylum')).toBe('Actinomycetota');
    expect(value('genus')).toBe('Streptomyces');
    expect(value('species')).toBe('');
  });

  it('genome taxonomy: one column per rank', () => {
    const genome = { genomeTaxonomy: { phylum: 'p__Bacillota', species: 's__Bacillus subtilis' } } as unknown as Sample;
    const value = (rank: string) => GENOME_EXPORT_COLUMNS.find((c) => c.id === `taxonomy_${rank}`)!.value(genome);
    expect(value('phylum')).toBe('Bacillota');
    expect(value('species')).toBe('Bacillus subtilis');
  });
});

describe('family cells', () => {
  const gcf = {
    id: 'g1', name: 'GCF-317926', familyClass: 'seed', petName: 'graceful-hedgehog',
    memberBgcCount: 23651, completeBgcCount: 10, assemblyCount: 22117,
    lengthStats: null,
    productCategoryDistribution: { 'NRPS+PKS': 84.2, NRPS: 8.8, PKS: 5.9, 'NRPS+PKS+RiPP': 0 },
    productTypeDistribution: {},
    biomeDistributionByLevel: { 1: { Environmental: 60, 'Host-associated': 40 } },
    taxonomyDistribution: {},
    taxonomyDistributionByRank: { phylum: { p__Pseudomonadota: 90, p__Unknown: 10 } },
    mibigCompounds: ['yersiniabactin'], mibigAccessions: ['BGC0001055'],
    knownCluster: { compound: 'yersiniabactin', accession: 'BGC0001055.4', similarity: 100, hitCount: 9000, coverage: 38.06 },
    avgDistance: 0.1234,
  } as unknown as GcfListItem;
  const cell = (id: string) => GCF_TABLE_EXPORT_COLUMNS.find((c) => c.id === id)!.value(gcf);

  it('writes the category partition as shares of members, never rescaled', () => {
    // 84.2 + 8.8 + 5.9 = 98.9: the remainder is real, not rounding to hide.
    expect(cell('productCategories')).toBe('NRPS+PKS 84.2%; NRPS 8.8%; PKS 5.9%');
  });

  it('keeps a KnownClusterBLAST compound with its share of members', () => {
    expect(cell('knownCluster')).toBe('yersiniabactin (BGC0001055.4), 100% similarity, 38.1% of members');
  });

  it('strips rank prefixes and keeps Unknown as the share it is', () => {
    expect(cell('taxonomy_phylum')).toBe('Pseudomonadota 90.0%; Unknown 10.0%');
    expect(cell('biomeDistribution_l1')).toBe('Environmental 60.0%; Host-associated 40.0%');
  });

  it('formatShares drops entries that round to nothing', () => {
    expect(formatShares({ a: 99.96, b: 0.04 })).toBe('a 100.0%');
  });
});

describe('study cells', () => {
  it('writes the composition as assignment counts, not shares of BGCs', () => {
    const study = { product_category_dist: { NRPS: 10, PKS: 12, RiPP: 0 } } as unknown as Study;
    const cell = STUDY_EXPORT_COLUMNS.find((c) => c.id === 'category_assignments')!.value(study);
    expect(cell).toBe('PKS 12; NRPS 10');
  });
});
