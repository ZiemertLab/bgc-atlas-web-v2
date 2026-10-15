import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

import { antismashViewerHref, getExportValue, type ExportableBgc } from './bgc-table-utils';
import type { BgcListItem } from './bgc-table-types';

const bgc = (over: Partial<BgcListItem>): BgcListItem => ({ id: 'b1', ...over }) as BgcListItem;

describe('antismashViewerHref', () => {
  it('returns null when the run has no archive', () => {
    expect(antismashViewerHref(bgc({ antismashRunId: null }))).toBeNull();
  });

  it('links to the viewer page for the run', () => {
    const href = antismashViewerHref(bgc({ antismashRunId: 'run-1' }));
    expect(href).toContain('/antismash/run-1');
  });

  it('passes the anchor through, url-encoded', () => {
    const href = antismashViewerHref(bgc({ antismashRunId: 'run-1', anchor: 'r45633c1' }));
    expect(href).toContain('?anchor=r45633c1');
  });

  // Opening the viewer must not wait for extraction; the viewer page reports it.
  it('is synchronous and does not trigger extraction', () => {
    const href = antismashViewerHref(bgc({ antismashRunId: 'run-1' }));
    expect(href).not.toBeInstanceOf(Promise);
    expect(typeof href).toBe('string');
  });
});

// Every field populated, so any column id without an export case reads as blank.
const fullBgc = (): ExportableBgc => ({
  id: 'b1',
  assembly: 'asm-1',
  assemblyDisplay: 'GCA_000001',
  sampleIds: ['s1'],
  sampleLabels: ['ERS000001'],
  dataSourceNames: ['gtdb', 'mgnify'],
  category: 'NRPS',
  products: ['NRPS', 'T1PKS'],
  completeness: 'complete',
  biomeLevels: ['root:Environmental:Terrestrial:Soil'],
  biomeEnvironment: [],
  goldEcosystemPath: 'Environmental:Terrestrial:Soil',
  taxonomyDomain: 'd__Bacteria',
  taxonomyPhylum: 'p__Actinomycetota',
  taxonomyClass: 'c__Actinomycetes',
  taxonomyOrder: 'o__Streptomycetales',
  taxonomyFamily: 'f__Streptomycetaceae',
  taxonomyGenus: 'g__Streptomyces',
  taxonomySpecies: 's__Streptomyces coelicolor',
  length: 41000,
  genes: 30,
  gcf: 'gcf-uuid',
  gcfName: 'GCF-04-000042',
  distance: 0.123,
  knownCluster: { compound: 'actinorhodin', accession: 'BGC0000194.5', similarity: 72 },
});

// Read from source: the column builders are React hooks and cannot run in a node test.
const columnIds = (file: string): string[] => {
  const src = readFileSync(resolve(__dirname, file), 'utf8');
  return [...src.matchAll(/^ {6}id: '(\w+)',$/gm)].map((m) => m[1]);
};

describe('getExportValue', () => {
  // Both BGC tables export through this function.
  it.each([
    ['the table component', './bgc-table-columns.tsx'],
    ['the /bgcs page', '../../../app/bgcs/page.tsx'],
  ])('exports a value for every column of %s', (_label, file) => {
    const ids = columnIds(file);
    expect(ids.length).toBeGreaterThan(10);
    const blank = ids.filter((id) => getExportValue(fullBgc(), id) === '');
    expect(blank).toEqual([]);
  });

  it('follows the rank the Taxonomy column is showing', () => {
    expect(getExportValue(fullBgc(), 'taxonomy')).toBe('Streptomyces coelicolor');
    expect(getExportValue(fullBgc(), 'taxonomy', { taxonomyRank: 'phylum' })).toBe('Actinomycetota');
    expect(getExportValue({ ...fullBgc(), taxonomyGenus: null }, 'taxonomy', { taxonomyRank: 'genus' })).toBe('');
  });

  it('exports the KnownClusterBLAST hit as the cell titles it, and blank without one', () => {
    expect(getExportValue(fullBgc(), 'knownCluster')).toBe('actinorhodin (BGC0000194.5), 72%');
    expect(getExportValue({ ...fullBgc(), knownCluster: null }, 'knownCluster')).toBe('');
  });

  it('exports distance at the three decimals the cell shows', () => {
    expect(getExportValue({ ...fullBgc(), distance: 1.49011611938477e-8 }, 'distance')).toBe('0.000');
    expect(getExportValue({ ...fullBgc(), distance: null }, 'distance')).toBe('');
  });

  it('exports the family name the GCF cell shows, not its uuid', () => {
    expect(getExportValue(fullBgc(), 'gcf')).toBe('GCF-04-000042');
  });
});
