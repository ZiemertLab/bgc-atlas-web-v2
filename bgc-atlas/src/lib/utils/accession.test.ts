import { describe, expect, it } from 'vitest';

import { bioprojectUrl, doiUrl, isBioProject, isDoi, pubmedUrl, showStudyKey } from './accession';

describe('isBioProject', () => {
  it.each(['PRJNA365333', 'PRJEB58634', 'PRJDB1234', 'prjna365333'])('accepts %s', (v) => {
    expect(isBioProject(v)).toBe(true);
  });

  it.each(['10.1093/gigascience/giaf135', 'MGYS00001976', 'mgp15454', ''])(
    'rejects %s',
    (v) => {
      expect(isBioProject(v)).toBe(false);
    }
  );
});

describe('isDoi', () => {
  it.each([
    '10.1093/gigascience/giaf135',
    '10.1038/s41586-025-09794-2',
    '10.1128/AEM.00275-17',
    '10.7554/eLife.36741',
  ])('accepts %s', (v) => {
    expect(isDoi(v)).toBe(true);
  });

  it.each(['PRJNA365333', 'MGYS00001976', '10.1038', '10.1038/', 'doi:10.1038/x', ''])(
    'rejects %s',
    (v) => {
      expect(isDoi(v)).toBe(false);
    }
  );

  it('tolerates surrounding whitespace, as stored values sometimes carry it', () => {
    expect(isDoi('  10.7554/eLife.36741 ')).toBe(true);
  });
});

describe('url builders', () => {
  it('keeps the slashes inside a DOI suffix', () => {
    expect(doiUrl('10.1093/gigascience/giaf135')).toBe(
      'https://doi.org/10.1093/gigascience/giaf135'
    );
  });

  it('builds BioProject and PubMed urls', () => {
    expect(bioprojectUrl('PRJNA365333')).toBe(
      'https://www.ncbi.nlm.nih.gov/bioproject/PRJNA365333'
    );
    expect(pubmedUrl('28363961')).toBe('https://pubmed.ncbi.nlm.nih.gov/28363961/');
  });
});

describe('showStudyKey', () => {
  const at = (key: string, identifiers: string[], title: string | null) =>
    showStudyKey(key, { identifiers, title });

  it('hides the key when it duplicates an accession chip', () => {
    expect(at('PRJNA224116', ['PRJNA224116'], 'Refseq Prokaryotic Genome Annotation Project')).toBe(false);
  });

  it('hides the key when it duplicates the title', () => {
    const t = 'EMG produced TPA metagenomics assembly of the Tara Oceans data set';
    expect(at(t, ['MGYS00002008', 'PRJEB22493'], t)).toBe(false);
  });

  it('hides custom_* internal source keys', () => {
    expect(at('custom_ziemert_lab', ['10.1093/gigascience/giaf135'], 'Ultra-deep long-read metagenomics')).toBe(false);
  });

  it('keeps an author slug that stands beside a real title', () => {
    expect(at('CritsChristoph_2018_soil', ['PRJNA449266'], 'Mediterranean grassland soil C-N turnover')).toBe(true);
    expect(at('JGI_hotspring_Yellowstone_phototrophic', [], 'Yellowstone phototrophic mats')).toBe(true);
  });

  it('matches case-insensitively and ignores surrounding whitespace', () => {
    expect(at('prjna224116', ['PRJNA224116'], null)).toBe(false);
    expect(at(' PRJNA224116 ', ['PRJNA224116'], null)).toBe(false);
    expect(at('PRJNA224116', [' prjna224116 '], null)).toBe(false);
  });

  it('hides a titleless study whose heading already falls back to the key', () => {
    // Callers pass the title as rendered, which falls back to study_key.
    expect(at('JGI_river_McNutts', [], 'JGI_river_McNutts')).toBe(false);
  });

  it('treats an empty or missing key as nothing to show', () => {
    expect(at('', ['PRJNA1'], 'A title')).toBe(false);
    expect(at('   ', ['PRJNA1'], 'A title')).toBe(false);
    expect(showStudyKey(null, { identifiers: [], title: 'A title' })).toBe(false);
    expect(showStudyKey(undefined, { identifiers: [], title: 'A title' })).toBe(false);
  });

  it('survives a null title and an empty identifier list', () => {
    expect(at('Ziels_2018_bioreactor', [], null)).toBe(true);
  });
});
