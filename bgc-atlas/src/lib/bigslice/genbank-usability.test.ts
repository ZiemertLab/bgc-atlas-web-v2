import { describe, expect, it } from 'vitest';
import {
  GenbankUsabilityScanner,
  bigSliceUnusableMessage,
  scanGenbankForBigSlice,
} from './genbank-usability';

/**
 * Each case is a branch of BiG-SLiCE 2.0.2's BGC.parse_gbk (see the module
 * comment). The records are synthetic; real antiSMASH output was checked
 * against BiG-SLiCE itself before this shipped.
 */

const antismashComment = (version: string) => [
  'COMMENT     ##antiSMASH-Data-START##',
  `            Version      :: ${version}`,
  '            Run date     :: 2026-10-09 10:00:00',
  '            ##antiSMASH-Data-END##',
];

function record(opts: { comment?: string[]; features: string[]; name?: string }): string {
  return [
    `LOCUS       ${opts.name ?? 'query'}                 120 bp    DNA     linear   UNK 01-JAN-1980`,
    'DEFINITION  test record.',
    ...(opts.comment ?? []),
    'FEATURES             Location/Qualifiers',
    '     source          1..120',
    '                     /mol_type="genomic DNA"',
    ...opts.features,
    'ORIGIN',
    '        1 atgaaaacag cgtatattgc gaaacagcgt cagattagct ttgtgaaaag ccattttagc',
    '       61 atgaaaacag cgtatattgc gaaacagcgt cagattagct ttgtgaaaag ccattttagc',
    '//',
    '',
  ].join('\n');
}

const protocluster = [
  '     protocluster    1..120',
  '                     /category="RiPP"',
  '                     /product="lassopeptide"',
];
const region = (qualifiers = ['/contig_edge="False"', '/product="lassopeptide"']) => [
  '     region          1..120',
  ...qualifiers.map((q) => `                     ${q}`),
  '                     /region_number="1"',
];
const cds = [
  '     CDS             1..120',
  '                     /locus_tag="ctg1_1"',
  '                     /translation="MKTAYIAKQRQISFVKSHFS"',
];

describe('antiSMASH 5-8 output', () => {
  it('accepts a region file', () => {
    const v = scanGenbankForBigSlice(record({ comment: antismashComment('7.0.0'), features: [...protocluster, ...region(), ...cds] }));
    expect(v).toEqual({ usable: true, kind: 'antismash5+', regions: 1 });
  });

  it('counts every region of a whole-record file', () => {
    const v = scanGenbankForBigSlice(record({
      comment: antismashComment('8.0.1'),
      features: [...protocluster, ...region(), ...protocluster, ...region()],
    }));
    expect(v).toEqual({ usable: true, kind: 'antismash5+', regions: 2 });
  });

  it('rejects an excerpt that kept the protocluster but lost the region', () => {
    const v = scanGenbankForBigSlice(record({ comment: antismashComment('7.0.0'), features: [...protocluster, ...cds] }));
    expect(v).toEqual({ usable: false, reason: 'no-region' });
  });

  it('rejects antiSMASH output with a region but no protocluster, which BiG-SLiCE does not recognise', () => {
    const v = scanGenbankForBigSlice(record({ comment: antismashComment('6.1.1'), features: [...region(), ...cds] }));
    expect(v).toEqual({ usable: false, reason: 'no-region' });
  });

  it('rejects a region missing /contig_edge, which crashes BiG-SLiCE', () => {
    const v = scanGenbankForBigSlice(record({
      comment: antismashComment('7.1.0'),
      features: [...protocluster, ...region(['/product="NRPS"'])],
    }));
    expect(v).toEqual({ usable: false, reason: 'incomplete-feature' });
  });

  it('accepts a MIBiG entry', () => {
    const v = scanGenbankForBigSlice(record({
      comment: antismashComment('7.1.0'),
      features: ['     subregion       1..120', '                     /aStool="mibig"', '                     /label="BGC0000001"', ...cds],
    }));
    expect(v).toEqual({ usable: true, kind: 'mibig', regions: 1 });
  });

  it('reads the version only from the antiSMASH structured comment', () => {
    // A Version line outside the markers is not what Biopython puts in structured_comment,
    // so BiG-SLiCE takes the file for antiSMASH 4 -- and finds no cluster.
    const v = scanGenbankForBigSlice(record({
      comment: ['COMMENT     Version      :: 7.0.0'],
      features: [...protocluster, ...region()],
    }));
    expect(v).toMatchObject({ usable: false, reason: 'plain-sequence' });
  });

  const mibigSubregion = (qualifiers = ['/aStool="mibig"', '/label="NRPS, PKS"']) => [
    '     subregion       1..120',
    ...qualifiers.map((q) => `                     ${q}`),
  ];
  const mibigDownload = record({
    name: 'BGC0002750',
    comment: antismashComment('False'),
    features: [...mibigSubregion(), ...region(), ...cds],
  });

  it("rejects a MIBiG download, whose antiSMASH block says 'Version :: False', as such", () => {
    // The commonest unusable upload.
    expect(scanGenbankForBigSlice(mibigDownload)).toEqual({ usable: false, reason: 'mibig-version' });
  });

  it('rejects a MIBiG subregion without /label, which crashes BiG-SLiCE', () => {
    const noLabel = record({ comment: antismashComment('7.1.0'), features: [...mibigSubregion(['/aStool="mibig"']), ...region()] });
    expect(scanGenbankForBigSlice(noLabel)).toEqual({ usable: false, reason: 'incomplete-feature' });
    // and with an unreadable version too, the missing /label is still the reason given
    const noLabelFalse = record({ comment: antismashComment('False'), features: [...mibigSubregion(['/aStool="mibig"']), ...region()] });
    expect(scanGenbankForBigSlice(noLabelFalse)).toEqual({ usable: false, reason: 'incomplete-feature' });
  });

  it('recognises a MIBiG entry whose protocluster comes before its MIBiG subregion', () => {
    // Some MIBiG downloads are laid out this way.
    const entry = record({ comment: antismashComment('False'), features: [...region(), ...protocluster, ...mibigSubregion()] });
    expect(scanGenbankForBigSlice(entry)).toEqual({ usable: false, reason: 'mibig-version' });
  });

  it('calls a Geneious re-export a trimmed copy, not a version problem', () => {
    // Geneious reflows the comment block (the version lands on the START line) and turns
    // every antiSMASH feature into misc_feature "Geneious type: region".
    const geneious = record({
      comment: ['COMMENT     ##antiSMASH-Data-START## Version      :: 7.1.0', '            ##antiSMASH-Data-END##'],
      features: ['     misc_feature    1..120', '                     /note="Geneious type: region"', ...cds],
    });
    expect(scanGenbankForBigSlice(geneious)).toEqual({ usable: false, reason: 'no-region' });
  });

  it('gives the version reason for a non-MIBiG file with an unrecognised version', () => {
    const v = scanGenbankForBigSlice(record({ comment: antismashComment('False'), features: [...protocluster, ...region()] }));
    expect(v).toEqual({ usable: false, reason: 'antismash-version' });
  });

  it('rejects a whole-genome file whose regions are all after the first record', () => {
    const contig = record({ name: 'contig1', comment: antismashComment('7.1.0'), features: cds });
    const withRegion = record({ name: 'contig2', comment: antismashComment('7.1.0'), features: [...protocluster, ...region()] });
    expect(scanGenbankForBigSlice(contig + withRegion)).toEqual({ usable: false, reason: 'regions-in-later-records' });
  });

  it('rejects a whole-genome file even when its first record has a region, rather than skip the rest silently', () => {
    const withRegion = record({ name: 'contig1', comment: antismashComment('7.1.0'), features: [...protocluster, ...region()] });
    expect(scanGenbankForBigSlice(withRegion + withRegion + withRegion)).toEqual({ usable: false, reason: 'regions-in-later-records' });
  });

  it('accepts a multi-record file whose later records hold no gene cluster', () => {
    const withRegion = record({ name: 'contig1', comment: antismashComment('7.1.0'), features: [...protocluster, ...region()] });
    const bare = record({ name: 'contig2', comment: antismashComment('7.1.0'), features: cds });
    expect(scanGenbankForBigSlice(withRegion + bare)).toEqual({ usable: true, kind: 'antismash5+', regions: 1 });
  });

  it('keeps a first-record reason ahead of the whole-genome one', () => {
    const incomplete = record({ name: 'contig1', comment: antismashComment('7.1.0'), features: [...protocluster, ...region(['/product="NRPS"'])] });
    const withRegion = record({ name: 'contig2', comment: antismashComment('7.1.0'), features: [...protocluster, ...region()] });
    expect(scanGenbankForBigSlice(incomplete + withRegion)).toEqual({ usable: false, reason: 'incomplete-feature' });
  });
});

describe('antiSMASH 4 output', () => {
  const cluster = (qualifiers = ['/note="Detection rule(s) for this cluster type: lassopeptide: ..."', '/product="lassopeptide"']) => [
    '     cluster         1..120',
    ...qualifiers.map((q) => `                     ${q}`),
  ];

  it('accepts one cluster', () => {
    expect(scanGenbankForBigSlice(record({ features: [...cluster(), ...cds] })))
      .toEqual({ usable: true, kind: 'antismash4', regions: 1 });
  });

  it('rejects two clusters', () => {
    expect(scanGenbankForBigSlice(record({ features: [...cluster(), ...cluster()] })))
      .toEqual({ usable: false, reason: 'multiple-clusters' });
  });

  it('rejects a cluster without /note, which crashes BiG-SLiCE', () => {
    expect(scanGenbankForBigSlice(record({ features: cluster(['/product="lassopeptide"']) })))
      .toEqual({ usable: false, reason: 'incomplete-feature' });
  });
});

describe('plain GenBank', () => {
  it('sends a single annotated gene to sequence search', () => {
    const v = scanGenbankForBigSlice(record({
      features: ['     CDS             1..120', '                     /label="simpL-A"'],
    }));
    expect(v).toEqual({ usable: false, reason: 'plain-sequence' });
  });

  it('sends a genome annotation to antiSMASH first', () => {
    const v = scanGenbankForBigSlice(record({ features: [...cds, ...cds, ...cds, ...cds] }));
    expect(v).toEqual({ usable: false, reason: 'plain-genome' });
  });
});

describe('reading', () => {
  const regionFile = record({ comment: antismashComment('7.0.0'), features: [...protocluster, ...region(), ...cds] });

  it('reads only the first record, as BiG-SLiCE does', () => {
    const plain = record({ name: 'first', features: cds });
    expect(scanGenbankForBigSlice(plain + regionFile)).toMatchObject({ usable: false });
    expect(scanGenbankForBigSlice(regionFile + plain)).toMatchObject({ usable: true });
  });

  it('gives the same verdict however the upload is chunked', () => {
    for (const size of [1, 7, 64, 4096]) {
      const scanner = new GenbankUsabilityScanner();
      for (let i = 0; i < regionFile.length; i += size) scanner.push(regionFile.slice(i, i + size));
      expect(scanner.finish()).toEqual({ usable: true, kind: 'antismash5+', regions: 1 });
    }
  });

  it('reads Windows line endings', () => {
    expect(scanGenbankForBigSlice(regionFile.replace(/\n/g, '\r\n'))).toMatchObject({ usable: true });
  });
});

describe('messages', () => {
  it('says what to do next for each kind of file', () => {
    expect(bigSliceUnusableMessage('gene.gbk', 'plain-sequence')).toMatch(/^'gene\.gbk' is plain GenBank.*Sequence similarity/);
    expect(bigSliceUnusableMessage('genome.gbk', 'plain-genome')).toMatch(/Run it through antiSMASH/);
    expect(bigSliceUnusableMessage('x.gbk', 'antismash-version')).toMatch(/without a version BiG-SLiCE recognises/);
    expect(bigSliceUnusableMessage('BGC0002750.gbk', 'mibig-version')).toMatch(/is a MIBiG GenBank download.*Version :: False/);
    expect(bigSliceUnusableMessage('x.gbk', 'regions-in-later-records')).toMatch(/whole-genome file.*one region per file/);
    expect(bigSliceUnusableMessage('x.gbk', 'no-region')).toMatch(/trimmed copy.*SnapGene, Geneious or similar software.*regionNNN\.gbk/);
  });
});
