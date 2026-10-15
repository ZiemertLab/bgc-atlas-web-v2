import { describe, expect, it } from 'vitest';

import { cdsFasta, looksLikeGenbank, originFasta, parseGenbank, selectSearchableCds } from './genbank';
import type { GenbankCds, GenbankRecord } from './genbank';

// Trimmed antiSMASH region output. Column positions matter: features at 5, qualifiers at 21.
const GBK = [
  'LOCUS       contig_1002            11307 bp    DNA              UNK 01-JAN-1980',
  'DEFINITION  contig_1002.',
  'FEATURES             Location/Qualifiers',
  '     region          1..11307',
  '                     /product="hydrogen-cyanide"',
  '     CDS             complement(3..467)',
  '                     /locus_tag="ctg5_1"',
  '                     /transl_table=11',
  '                     /translation="MTEHTPSSLIVTFFGAYGRAELDGRVPVAALIRLMGAVDVDPQSV',
  '                     RSAVSRLKRRELLVPDRVGG"',
  '     CDS             2190..3305',
  '                     /gene_kind="biosynthetic"',
  '                     /locus_tag="ctg5_3"',
  '                     /product="acyl-CoA dehydrogenase"',
  '                     /translation="MPAFALDPEQLKWCAEVRSLAAGRLRPLAEAGE"',
  '     aSDomain        complement(766..1944)',
  '                     /aSDomain="AMP-binding"',
  '                     /locus_tag="ctg5_2"',
  '                     /translation="SPGAPCLRTPGGEVWSYEDLNATAARIAHVLADDLG"',
  '     CDS_motif       complement(1456..1515)',
  '                     /label="NRPS-A_a3"',
  '                     /translation="ALIAFTSGTTGRPKGCMHFH"',
  '     CDS             4000..4200',
  '                     /locus_tag="ctg5_nopep"',
  '                     /note="hypothetical protein, wrapping note that continues',
  '                     onto a second line"',
  'ORIGIN',
  '        1 cggcgcaggg tgtggcgggc ctcctcctgg acgtgggccg gggctatcca gacgccgggc',
  '       61 gccgcgctgc cgaagccgag ccgggccagc',
  '//',
].join('\n');

describe('looksLikeGenbank', () => {
  it('recognises a LOCUS header and rejects FASTA', () => {
    expect(looksLikeGenbank(GBK)).toBe(true);
    expect(looksLikeGenbank('>query\nMKTAYIAK')).toBe(false);
    expect(looksLikeGenbank('MKTAYIAK')).toBe(false);
  });
});

describe('parseGenbank', () => {
  const record = parseGenbank(GBK)!;

  it('reads the locus name and declared length', () => {
    expect(record.locus).toBe('contig_1002');
    expect(record.length).toBe(11307);
  });

  it('takes translations from CDS features only', () => {
    expect(record.cdsFeatures).toHaveLength(3);
    expect(record.cdsFeatures.map((c) => c.locusTag)).toEqual(['ctg5_1', 'ctg5_3', 'ctg5_nopep']);
    expect(record.cdsFeatures.some((c) => c.translation?.startsWith('SPGAPC'))).toBe(false);
    expect(record.cdsFeatures.some((c) => c.translation === 'ALIAFTSGTTGRPKGCMHFH')).toBe(false);
  });

  it('joins a wrapped translation with no separator', () => {
    const [first] = record.cdsFeatures;
    expect(first.translation).toBe(
      'MTEHTPSSLIVTFFGAYGRAELDGRVPVAALIRLMGAVDVDPQSVRSAVSRLKRRELLVPDRVGG'
    );
    expect(first.translation).toMatch(/^[A-Z*]+$/);
  });

  it('reads strand from complement()', () => {
    expect(record.cdsFeatures[0]).toMatchObject({ start: 3, end: 467, strand: '-' });
    expect(record.cdsFeatures[1]).toMatchObject({ start: 2190, end: 3305, strand: '+' });
  });

  it('flags antiSMASH core biosynthetic genes', () => {
    expect(record.cdsFeatures[0].isCore).toBe(false);
    expect(record.cdsFeatures[1].isCore).toBe(true);
    expect(record.cdsFeatures[1].product).toBe('acyl-CoA dehydrogenase');
  });

  it('keeps the full gene_kind, not just the core flag', () => {
    expect(record.cdsFeatures[1].geneKind).toBe('biosynthetic');
  });

  it('leaves gene_kind undefined for genes antiSMASH never classified', () => {
    expect(record.cdsFeatures[0].geneKind).toBeUndefined();
  });

  it.each([
    ['biosynthetic-additional', 'biosynthetic-additional'],
    ['regulatory', 'regulatory'],
    ['transport', 'transport'],
    ['resistance', 'resistance'],
    ['other', 'other'],
    ['BIOSYNTHETIC', 'biosynthetic'],
  ])('reads /gene_kind="%s"', (written, expected) => {
    const gbk = [
      'LOCUS       x            30 bp    DNA              UNK 01-JAN-1980',
      'FEATURES             Location/Qualifiers',
      '     CDS             1..30',
      '                     /locus_tag="ctg1_1"',
      `                     /gene_kind="${written}"`,
      '                     /translation="MPAFALDPE"',
    ].join('\n');
    expect(parseGenbank(gbk)!.cdsFeatures[0].geneKind).toBe(expected);
  });

  it('ignores a gene_kind outside the vocabulary rather than trusting it as a colour key', () => {
    const gbk = [
      'LOCUS       x            30 bp    DNA              UNK 01-JAN-1980',
      'FEATURES             Location/Qualifiers',
      '     CDS             1..30',
      '                     /locus_tag="ctg1_1"',
      '                     /gene_kind="something-new"',
      '                     /translation="MPAFALDPE"',
    ].join('\n');
    expect(parseGenbank(gbk)!.cdsFeatures[0].geneKind).toBeUndefined();
  });

  it('keeps a CDS that has no translation', () => {
    const bare = record.cdsFeatures[2];
    expect(bare.locusTag).toBe('ctg5_nopep');
    expect(bare.translation).toBeUndefined();
  });

  it('strips numbering and spaces out of ORIGIN', () => {
    expect(record.origin).toMatch(/^[ACGTN]+$/);
    expect(record.origin.startsWith('CGGCGCAGGGTGTGGCGGGC')).toBe(true);
    expect(record.origin).toHaveLength(90);
  });

  it('returns null for input that is not GenBank', () => {
    expect(parseGenbank('>query\nMKTAYIAK')).toBeNull();
  });
});

describe('cdsFasta / originFasta', () => {
  const record = parseGenbank(GBK)!;

  it('emits one record per translated CDS, headed by locus_tag', () => {
    const fasta = cdsFasta(record);
    expect(fasta.match(/^>/gm)).toHaveLength(2); // ctg5_nopep has no translation
    expect(fasta).toContain('>ctg5_1');
    expect(fasta).toContain('>ctg5_3');
    expect(fasta).not.toContain('>ctg5_nopep');
  });

  it('emits the nucleotides under the locus name', () => {
    expect(originFasta(record).split('\n')[0]).toBe('>contig_1002');
  });

  it('emits nothing when there is no ORIGIN to fall back to', () => {
    const noOrigin = parseGenbank(GBK.replace(/ORIGIN[\s\S]*/, '//'))!;
    expect(noOrigin.origin).toBe('');
    expect(originFasta(noOrigin)).toBe('');
  });
});

describe('selectSearchableCds', () => {
  const cds = (locusTag: string, len: number, isCore = false): GenbankCds => ({
    locusTag, start: 1, end: len * 3, strand: '+', translation: 'M'.repeat(len), isCore,
  });
  const record = (cdsFeatures: GenbankCds[]): GenbankRecord => ({
    locus: 'r', length: 1000, cdsFeatures, origin: 'ACGT',
  });
  const bounds = { min: 10, max: 100 };

  it('keeps everything that fits', () => {
    const out = selectSearchableCds(record([cds('a', 50), cds('b', 60)]), bounds, 100);
    expect(out.selected.map((c) => c.locusTag)).toEqual(['a', 'b']);
    expect(out.tooShort).toEqual([]);
    expect(out.overLimit).toEqual([]);
  });

  it('skips the out-of-bounds genes instead of failing the record', () => {
    const out = selectSearchableCds(
      record([cds('short', 5), cds('ok', 50), cds('long', 500)]),
      bounds,
      100
    );
    expect(out.selected.map((c) => c.locusTag)).toEqual(['ok']);
    expect(out.tooShort).toEqual(['short']);
    expect(out.tooLong).toEqual(['long']);
  });

  it('ignores CDS features that carry no translation', () => {
    const withoutPeptide = { ...cds('none', 50), translation: undefined };
    const out = selectSearchableCds(record([withoutPeptide, cds('ok', 50)]), bounds, 100);
    expect(out.selected.map((c) => c.locusTag)).toEqual(['ok']);
    expect(out.tooShort).toEqual([]);
  });

  it('keeps core biosynthetic genes when over the limit, even if short', () => {
    const out = selectSearchableCds(
      record([cds('big1', 90), cds('core', 12, true), cds('big2', 80)]),
      bounds,
      2
    );
    expect(out.selected.map((c) => c.locusTag)).toContain('core');
    expect(out.selected).toHaveLength(2);
    expect(out.overLimit).toEqual(['big2']);
  });

  it('fills the remaining slots by length', () => {
    const out = selectSearchableCds(
      record([cds('s', 20), cds('m', 50), cds('l', 90)]),
      bounds,
      2
    );
    expect(out.selected.map((c) => c.locusTag)).toEqual(['m', 'l']);
    expect(out.overLimit).toEqual(['s']);
  });

  it('returns survivors in file order, not ranked order', () => {
    const out = selectSearchableCds(
      record([cds('first', 20), cds('second', 90), cds('third', 50)]),
      bounds,
      2
    );
    expect(out.selected.map((c) => c.locusTag)).toEqual(['second', 'third']);
  });
});
