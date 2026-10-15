import { describe, expect, it } from 'vitest';

import { genbankCdsTranslations, genbankSequences, genbankToNucleotideFasta, genbankToProteinFasta } from './genbank';
import { downloadFilename, escapeTarGlob, regionMemberName } from './region-member';

// A trimmed antiSMASH region record: a multi-line location, an aSDomain that also
// carries a /translation (must NOT become a protein), and a CDS with no locus_tag.
const GBK = `LOCUS       contig_1               130 bp    DNA              UNK 01-JAN-1980
DEFINITION  contig_1.
FEATURES             Location/Qualifiers
     protocluster    1..130
                     /product="terpene"
     CDS             complement(join(1..30,
                     40..60))
                     /locus_tag="ctg1_1"
                     /translation="MKLV
                     QQR"
     aSDomain        1..30
                     /translation="MKL"
     CDS             70..120
                     /protein_id="WP_1.1"
                     /translation="MSTN"
     CDS             121..130
                     /note="no translation"
ORIGIN
        1 atgaaactgg tgcagcagcg ttaaatgaaa ctggtgcagc agcgttaaat gaaactggtg
       61 cagcagcgtt aaatgaaact ggtgcagcag cgttaaatga aactggtgca gcagcgttaa
      121 atgaaactgg
//
`;

describe('genbank conversion', () => {
  it('reads the ORIGIN residues, upper-cased, whitespace and numbers stripped', () => {
    const [seq] = genbankSequences(GBK);
    expect(seq).toHaveLength(130);
    expect(seq.startsWith('ATGAAACTGG')).toBe(true);
    expect(seq).toMatch(/^[ACGT]+$/);
  });

  it('writes a wrapped nucleotide FASTA under the given header', () => {
    const fasta = genbankToNucleotideFasta(GBK, 'bgc-1 contig_1.region001');
    const [header, ...lines] = fasta.trim().split('\n');
    expect(header).toBe('>bgc-1 contig_1.region001');
    expect(lines.every((l) => l.length <= 80)).toBe(true);
    expect(lines.join('')).toHaveLength(130);
  });

  it('takes translations from CDS features only, joining multi-line values', () => {
    const cds = genbankCdsTranslations(GBK);
    expect(cds).toEqual([
      { name: 'ctg1_1', location: 'complement(join(1..30,40..60))', translation: 'MKLVQQR' },
      { name: 'WP_1.1', location: '70..120', translation: 'MSTN' },
    ]);
  });

  it('writes a protein FASTA named prefix|locus location', () => {
    expect(genbankToProteinFasta(GBK, 'bgc-1')).toBe(
      '>bgc-1|ctg1_1 complement(join(1..30,40..60))\nMKLVQQR\n>bgc-1|WP_1.1 70..120\nMSTN\n',
    );
  });

  it('returns nothing for a file with no ORIGIN or FEATURES', () => {
    expect(genbankToNucleotideFasta('LOCUS x\n//\n', 'h')).toBe('');
    expect(genbankToProteinFasta('LOCUS x\n//\n', 'h')).toBe('');
  });
});

describe('region member name', () => {
  it('strips the archive prefix from bgcs.filename', () => {
    expect(regionMemberName('MFD01275_contig_5500.region020', '/x/MFD01275.tar.gz')).toBe('contig_5500.region020.gbk');
    expect(regionMemberName('GB_GCA_000003955.1_CM000741.1.region001', '/x/GB_GCA_000003955.1.tar.gz'))
      .toBe('CM000741.1.region001.gbk');
  });

  it('keeps a filename that does not carry the prefix', () => {
    expect(regionMemberName('contig_9.region001', '/x/OTHER.tar.gz')).toBe('contig_9.region001.gbk');
  });

  it('escapes tar glob metacharacters', () => {
    expect(escapeTarGlob('ctg[1]*?.gbk')).toBe('ctg\\[1\\]\\*\\?.gbk');
  });

  it('builds a safe download name per format', () => {
    expect(downloadFilename('MFD01275_contig_5500.region020', 'fna')).toBe('MFD01275_contig_5500.region020.fna');
    expect(downloadFilename('a b/c"d.gbk', 'gbk')).toBe('a_b_c_d.gbk');
  });
});
