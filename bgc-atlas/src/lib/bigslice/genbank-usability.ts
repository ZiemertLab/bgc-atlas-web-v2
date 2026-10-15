/**
 * Would BiG-SLiCE find a BGC in this GenBank file?
 *
 * BiG-SLiCE 2.0.2 (`bigslice/modules/data/bgc.py`, `BGC.parse_gbk`) reads a
 * query file like this:
 *
 *  - Only the FIRST record. The record loop ends in an unconditional `break`,
 *    so the rest of a multi-record file is never read.
 *  - antiSMASH 5-8 output, recognised by the `Version` in the structured
 *    `##antiSMASH-Data-START##` comment, is a "clustergbk" only if a
 *    `protocluster` feature (or a MIBiG `subregion` with /aStool="mibig")
 *    comes first. Then every `region` feature is one BGC, read through
 *    `qual["contig_edge"][0]` and `qual["product"]`, so a region missing
 *    either raises KeyError and kills the whole query.
 *  - Anything else is taken for antiSMASH 4: exactly one `cluster` feature,
 *    read through `qual["note"]` and `qual["product"]` (KeyError again).
 *
 * A file that yields no BGC is not an error to BiG-SLiCE. It prints "is not a
 * recognized antiSMASH clustergbk" and carries on, and when no file yielded
 * one, sklearn's normalize() fails on the empty feature matrix ("Found array
 * with 0 sample(s)"). So the submit route checks here instead, and the reader
 * is told what to upload rather than handed a failed job.
 *
 * The reasons are split by what the reader should do next, which is why they
 * are finer than BiG-SLiCE's own yes/no. Among real uploads the common cases are
 * MIBiG downloads, whose
 * antiSMASH block says `Version :: False`; plain GenBank never run through
 * antiSMASH; and antiSMASH whole-genome files, whose regions sit in records
 * BiG-SLiCE never reads.
 *
 * Whole-genome files are rejected even when their first record has a region:
 * BiG-SLiCE would search that one and skip the rest without saying so.
 *
 * Fed line by line while the upload streams to disk, so a 50 MB file is not
 * read twice. After the first record only gene cluster features (`region`, or
 * antiSMASH 4's `cluster`) are counted.
 */

export type BigSliceUsability =
  | { usable: true; kind: 'antismash5+' | 'mibig' | 'antismash4'; regions: number }
  | { usable: false; reason: BigSliceUnusableReason };

export type BigSliceUnusableReason =
  /** Plain GenBank of a gene or two: a job for sequence search. */
  | 'plain-sequence'
  /** Plain GenBank of a genome or contig: needs antiSMASH first. */
  | 'plain-genome'
  /**
   * A MIBiG entry whose antiSMASH block says `Version :: False`, as MIBiG's GenBank
   * downloads do. Rejected like any other unreadable file -- uploads are never
   * edited -- but told apart so the message can say what is wrong with it.
   */
  | 'mibig-version'
  /** An antiSMASH block whose Version is not 5-8, on a file that is not a MIBiG entry. */
  | 'antismash-version'
  /** A whole-genome file: gene clusters in records after the first, which BiG-SLiCE does not read. */
  | 'regions-in-later-records'
  /** antiSMASH 5+ output with no `region` (or no `protocluster`): no BGC found, or a trimmed copy. */
  | 'no-region'
  /** A `region` or antiSMASH 4 `cluster` without a qualifier BiG-SLiCE reads unguarded. */
  | 'incomplete-feature'
  /** antiSMASH 4 output with two or more `cluster` features. */
  | 'multiple-clusters';

const ANTISMASH_5_PLUS = new Set(['5', '6', '7', '8']);
/** A feature key line: key at column 6, location at column 22. */
const FEATURE_KEY = /^ {5}(\S+)\s+\S/;
/** A qualifier line: `/name` or `/name=value` at column 22. */
const QUALIFIER = /^ {21}\/([^=\s]+)(?:=(.*))?$/;
/** Longest partial line kept between chunks; sequence-free junk beyond it is not looked at. */
const MAX_LINE = 64 * 1024;
/** At most this many CDS features and a plain GenBank file reads as a gene, not a genome. */
const MAX_GENE_CDS = 3;

interface FeatureSeen {
  key: string;
  qualifiers: Map<string, string>;
}

export class GenbankUsabilityScanner {
  private partial = '';
  /** Past the first record's `//`: only gene cluster features are counted from here. */
  private laterRecords = false;
  private laterClusters = 0;
  private section: 'header' | 'comment' | 'features' | 'after' = 'header';
  private inAntismashComment = false;
  private sawAntismashBlock = false;
  private antismashVersion = '';
  private current: FeatureSeen | null = null;

  /** First of `protocluster` / MIBiG `subregion` seen, which decides the antiSMASH 5+ branch. */
  private as5Type: 'antismash5+' | 'mibig' | null = null;
  /** The deciding MIBiG subregion lacks /label, which BiG-SLiCE reads unguarded. */
  private incompleteMibig = false;
  /** Any MIBiG subregion in the first record: the file is a MIBiG entry. */
  private sawMibigSubregion = false;
  private regions = 0;
  private incompleteRegion = false;
  private clusters = 0;
  private incompleteCluster = false;
  private cdsFeatures = 0;

  push(text: string): void {
    const lines = (this.partial + text).split('\n');
    this.partial = lines.pop() ?? '';
    if (this.partial.length > MAX_LINE) this.partial = this.partial.slice(0, MAX_LINE);
    for (const line of lines) this.line(line.endsWith('\r') ? line.slice(0, -1) : line);
  }

  finish(): BigSliceUsability {
    if (this.partial) {
      this.line(this.partial.endsWith('\r') ? this.partial.slice(0, -1) : this.partial);
      this.partial = '';
    }
    this.closeFeature();
    const verdict = this.firstRecordVerdict();
    // A whole-genome file. Rejected whether or not its first record would do: what
    // BiG-SLiCE skipped, it would skip silently. A reason about the first record
    // itself (a missing qualifier, MIBiG's version) still comes first.
    if (this.laterClusters > 0 && (verdict.usable || verdict.reason === 'no-region')) {
      return { usable: false, reason: 'regions-in-later-records' };
    }
    return verdict;
  }

  /** BiG-SLiCE's verdict on the one record it reads. */
  private firstRecordVerdict(): BigSliceUsability {
    if (ANTISMASH_5_PLUS.has(this.antismashVersion.split('.')[0])) return this.antismash5Verdict();

    // BiG-SLiCE takes everything else for antiSMASH 4.
    if (this.clusters === 1) {
      if (this.incompleteCluster) return { usable: false, reason: 'incomplete-feature' };
      return { usable: true, kind: 'antismash4', regions: 1 };
    }
    if (this.clusters > 1) return { usable: false, reason: 'multiple-clusters' };

    if (this.sawAntismashBlock) {
      // A MIBiG entry the version line alone keeps BiG-SLiCE from reading -- whichever
      // of its subregion or protocluster comes first. If it would fail even with a
      // readable version, that other reason is the one to give.
      if (this.sawMibigSubregion) {
        const mended = this.antismash5Verdict();
        return mended.usable ? { usable: false, reason: 'mibig-version' } : mended;
      }
      // The antiSMASH block survived but none of its features did: a copy edited and
      // re-exported elsewhere (Geneious turns them into misc_feature "Geneious type:
      // region"), or cut down. Its version is not what the reader needs to hear about.
      if (this.as5Type === null && this.regions === 0) return { usable: false, reason: 'no-region' };
      return { usable: false, reason: 'antismash-version' };
    }
    return { usable: false, reason: this.cdsFeatures <= MAX_GENE_CDS ? 'plain-sequence' : 'plain-genome' };
  }

  /** BiG-SLiCE's antiSMASH 5-8 reader, on what the first record held. */
  private antismash5Verdict(): BigSliceUsability {
    if (this.as5Type === 'mibig') {
      if (this.incompleteMibig) return { usable: false, reason: 'incomplete-feature' };
      return { usable: true, kind: 'mibig', regions: 1 };
    }
    if (this.as5Type !== 'antismash5+' || this.regions === 0) return { usable: false, reason: 'no-region' };
    if (this.incompleteRegion) return { usable: false, reason: 'incomplete-feature' };
    return { usable: true, kind: 'antismash5+', regions: this.regions };
  }

  private line(line: string): void {
    if (line.startsWith('//')) {
      this.closeFeature();
      this.laterRecords = true;
      this.section = 'header';
      return;
    }

    // A top-level keyword (column 1) changes section.
    if (line && line[0] !== ' ') {
      this.closeFeature();
      if (line.startsWith('COMMENT')) this.section = 'comment';
      else if (line.startsWith('FEATURES')) this.section = 'features';
      else if (this.section === 'features' || this.section === 'after') this.section = 'after';
      else this.section = 'header';
      if (this.section !== 'comment') return;
    }

    if (this.section === 'comment') {
      if (this.laterRecords) return;
      if (line.includes('##antiSMASH-Data-START##')) {
        this.inAntismashComment = true;
        this.sawAntismashBlock = true;
      }
      else if (line.includes('##antiSMASH-Data-END##')) this.inAntismashComment = false;
      else if (this.inAntismashComment && !this.antismashVersion) {
        const m = line.match(/^\s+Version\s+::\s*(\S+)/);
        if (m) this.antismashVersion = m[1];
      }
      return;
    }

    if (this.section !== 'features') return;

    const key = line.match(FEATURE_KEY);
    if (key) {
      this.closeFeature();
      this.current = { key: key[1], qualifiers: new Map() };
      return;
    }
    if (this.laterRecords) return;
    const qualifier = line.match(QUALIFIER);
    if (qualifier && this.current && !this.current.qualifiers.has(qualifier[1])) {
      this.current.qualifiers.set(qualifier[1], (qualifier[2] ?? '').replace(/^"|"$/g, ''));
    }
  }

  private closeFeature(): void {
    const feature = this.current;
    this.current = null;
    if (!feature) return;
    if (this.laterRecords) {
      if (feature.key === 'region' || feature.key === 'cluster') this.laterClusters += 1;
      return;
    }
    const has = (name: string) => feature.qualifiers.has(name);

    switch (feature.key) {
      case 'protocluster':
        this.as5Type ??= 'antismash5+';
        break;
      case 'subregion':
        if (feature.qualifiers.get('aStool') === 'mibig') this.sawMibigSubregion = true;
        if (feature.qualifiers.get('aStool') === 'mibig' && this.as5Type === null) {
          this.as5Type = 'mibig';
          // BiG-SLiCE reads `qual["label"][0]` of the first MIBiG subregion it meets.
          this.incompleteMibig = !has('label');
        }
        break;
      case 'region':
        this.regions += 1;
        if (!has('contig_edge') || !has('product')) this.incompleteRegion = true;
        break;
      case 'cluster':
        this.clusters += 1;
        if (!has('note') || !has('product')) this.incompleteCluster = true;
        break;
      case 'CDS':
        this.cdsFeatures += 1;
        break;
    }
  }
}

/** Scan a whole file held in memory (tests, the agreement check). */
export function scanGenbankForBigSlice(text: string): BigSliceUsability {
  const scanner = new GenbankUsabilityScanner();
  scanner.push(text);
  return scanner.finish();
}

/** What the reader is told when a file is rejected: what is wrong, and what to upload instead. */
export function bigSliceUnusableMessage(fileName: string, reason: BigSliceUnusableReason): string {
  switch (reason) {
    case 'plain-sequence':
      return `'${fileName}' is plain GenBank, not antiSMASH output, so BiG-SLiCE has nothing to compare. ` +
        'To search a gene or protein sequence, use Sequence similarity.';
    case 'plain-genome':
      return `'${fileName}' is plain GenBank, not antiSMASH output, so BiG-SLiCE has nothing to compare. ` +
        'Run it through antiSMASH (5 or later) first and upload the regionNNN.gbk files it writes.';
    case 'mibig-version':
      return `'${fileName}' is a MIBiG GenBank download. Its antiSMASH block says 'Version :: False', ` +
        "which BiG-SLiCE cannot read. Run the entry's sequence through antiSMASH 5 or later and upload the region file it writes.";
    case 'antismash-version':
      return `'${fileName}' has an antiSMASH block without a version BiG-SLiCE recognises, ` +
        'so BiG-SLiCE cannot read it. Run the sequence through antiSMASH 5 or later and upload the region file it writes.';
    case 'regions-in-later-records':
      return `'${fileName}' is an antiSMASH whole-genome file with gene cluster regions beyond its first record, ` +
        'and BiG-SLiCE reads only the first record. Upload the regionNNN.gbk files antiSMASH wrote instead, one region per file.';
    case 'no-region':
      return `'${fileName}' is antiSMASH output but contains no region: either antiSMASH found no gene cluster in it, ` +
        'or it is a trimmed copy of a region file (editing and re-exporting in SnapGene, Geneious or similar ' +
        'software can drop it). Upload a regionNNN.gbk file as antiSMASH wrote it.';
    case 'incomplete-feature':
      return `'${fileName}' has a region or cluster feature missing qualifiers BiG-SLiCE needs ` +
        '(/contig_edge and /product, /label for a MIBiG entry, or /note for antiSMASH 4). ' +
        'Upload the file as antiSMASH wrote it.';
    case 'multiple-clusters':
      return `'${fileName}' contains more than one antiSMASH 4 cluster; BiG-SLiCE reads one per file.`;
  }
}
