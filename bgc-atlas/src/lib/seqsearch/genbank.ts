// Minimal GenBank reader for the sequence search: LOCUS, CDS features and ORIGIN only.

export interface GenbankCds {
  /** /locus_tag, or a synthesised name when the feature has none. */
  locusTag: string;
  /** 1-based inclusive, always start <= end. */
  start: number;
  end: number;
  strand: '+' | '-';
  translation?: string;
  /** /gene_kind="biosynthetic". */
  isCore: boolean;
  /** Only genes inside a detected region carry one. */
  geneKind?: GeneKind;
  product?: string;
}

// Matches the BGC viewer's GeneType so both views colour a gene the same way.
export type GeneKind =
  | 'biosynthetic'
  | 'biosynthetic-additional'
  | 'regulatory'
  | 'transport'
  | 'resistance'
  | 'other';

const GENE_KINDS: readonly GeneKind[] = [
  'biosynthetic',
  'biosynthetic-additional',
  'regulatory',
  'transport',
  'resistance',
  'other',
];

function parseGeneKind(values: string[] | undefined): GeneKind | undefined {
  return values?.map((v) => v.trim().toLowerCase()).find((v): v is GeneKind =>
    (GENE_KINDS as readonly string[]).includes(v),
  );
}

export interface GenbankRecord {
  locus: string;
  /** From the LOCUS line; falls back to the ORIGIN length. */
  length: number;
  cdsFeatures: GenbankCds[];
  origin: string;
}

export function looksLikeGenbank(input: string): boolean {
  return /^LOCUS\s+\S/m.test(input);
}

// Tracking feature boundaries keeps aSDomain and CDS_motif translations (CDS fragments) out.
const FEATURE_START = /^ {5}(\S+)\s+(.+)$/;
const QUALIFIER_START = /^ {21}\/(\w+)=?(.*)$/;
const CONTINUATION = /^ {21}(.*)$/;

interface RawFeature {
  type: string;
  location: string;
  qualifiers: Map<string, string[]>;
}

function parseLocation(location: string): { start: number; end: number; strand: '+' | '-' } | null {
  const strand: '+' | '-' = /complement\s*\(/.test(location) ? '-' : '+';
  // join()/order() collapse to the outermost pair; fuzzy bounds (<1..>500) lose their markers.
  const numbers = location.match(/\d+/g);
  if (!numbers || numbers.length === 0) return null;
  const values = numbers.map(Number).filter(Number.isFinite);
  if (!values.length) return null;
  const start = Math.min(...values);
  const end = Math.max(...values);
  return { start, end, strand };
}

function qualifierValue(feature: RawFeature, name: string): string | undefined {
  const values = feature.qualifiers.get(name);
  if (!values || !values.length) return undefined;
  return values[0];
}

// A /translation joins with no separator; free text like /note needs a space.
function joinQualifier(name: string, parts: string[]): string {
  const separator = name === 'translation' ? '' : ' ';
  return parts
    .join(separator)
    .replace(/^"|"$/g, '')
    .trim();
}

export function parseGenbank(input: string): GenbankRecord | null {
  if (!looksLikeGenbank(input)) return null;

  const lines = input.split(/\r?\n/);

  const locusLine = lines.find((line) => line.startsWith('LOCUS'));
  const locusMatch = locusLine?.match(/^LOCUS\s+(\S+)\s+(\d+)\s+bp/);
  const locus = locusMatch?.[1] ?? 'query';
  const declaredLength = locusMatch ? Number(locusMatch[2]) : 0;

  const features: RawFeature[] = [];
  const originChunks: string[] = [];

  let section: 'header' | 'features' | 'origin' = 'header';
  let current: RawFeature | null = null;
  let currentQualifier: { name: string; parts: string[] } | null = null;

  const flushQualifier = () => {
    if (!current || !currentQualifier) return;
    const existing = current.qualifiers.get(currentQualifier.name) ?? [];
    existing.push(joinQualifier(currentQualifier.name, currentQualifier.parts));
    current.qualifiers.set(currentQualifier.name, existing);
    currentQualifier = null;
  };

  const flushFeature = () => {
    flushQualifier();
    if (current) features.push(current);
    current = null;
  };

  for (const line of lines) {
    if (line.startsWith('FEATURES')) {
      section = 'features';
      continue;
    }
    if (line.startsWith('ORIGIN')) {
      flushFeature();
      section = 'origin';
      continue;
    }
    if (line.startsWith('//')) {
      flushFeature();
      break;
    }

    if (section === 'origin') {
      originChunks.push(line.replace(/[\d\s]/g, ''));
      continue;
    }

    if (section !== 'features') continue;

    const featureMatch = line.match(FEATURE_START);
    if (featureMatch) {
      flushFeature();
      current = { type: featureMatch[1], location: featureMatch[2].trim(), qualifiers: new Map() };
      continue;
    }

    if (!current) continue;

    const qualifierMatch = line.match(QUALIFIER_START);
    if (qualifierMatch) {
      flushQualifier();
      currentQualifier = { name: qualifierMatch[1], parts: [qualifierMatch[2] ?? ''] };
      continue;
    }

    const continuation = line.match(CONTINUATION);
    if (continuation) {
      if (currentQualifier) currentQualifier.parts.push(continuation[1]);
      // A location too long for one line continues before any qualifier appears.
      else current.location += continuation[1].trim();
    }
  }
  flushFeature();

  const origin = originChunks.join('').toUpperCase();

  let unnamed = 0;
  const cdsFeatures: GenbankCds[] = [];
  for (const feature of features) {
    if (feature.type !== 'CDS') continue;
    const span = parseLocation(feature.location);
    if (!span) continue;

    const translation = qualifierValue(feature, 'translation')?.replace(/\s+/g, '');
    unnamed += 1;
    cdsFeatures.push({
      locusTag: qualifierValue(feature, 'locus_tag') ?? qualifierValue(feature, 'gene') ?? `cds_${unnamed}`,
      start: span.start,
      end: span.end,
      strand: span.strand,
      translation: translation || undefined,
      isCore: (feature.qualifiers.get('gene_kind') ?? []).some((v) => v === 'biosynthetic'),
      geneKind: parseGeneKind(feature.qualifiers.get('gene_kind')),
      product: qualifierValue(feature, 'product'),
    });
  }

  return {
    locus,
    length: declaredLength || origin.length,
    cdsFeatures,
    origin,
  };
}

export interface CdsSelection {
  selected: GenbankCds[];
  tooShort: string[];
  tooLong: string[];
  /** Dropped only because the record carries more CDSs than a submission allows. */
  overLimit: string[];
}

// Per-sequence limits apply per gene, so out-of-bounds genes are skipped rather than failing
// the file. Over the cap, core biosynthetic genes are kept first, then the rest by length.
export function selectSearchableCds(
  record: GenbankRecord,
  bounds: { min: number; max: number },
  limit: number
): CdsSelection {
  const tooShort: string[] = [];
  const tooLong: string[] = [];
  const usable: GenbankCds[] = [];

  for (const cds of record.cdsFeatures) {
    if (!cds.translation) continue;
    if (cds.translation.length < bounds.min) tooShort.push(cds.locusTag);
    else if (cds.translation.length > bounds.max) tooLong.push(cds.locusTag);
    else usable.push(cds);
  }

  if (usable.length <= limit) {
    return { selected: usable, tooShort, tooLong, overLimit: [] };
  }

  const ranked = [...usable].sort((a, b) => {
    if (a.isCore !== b.isCore) return a.isCore ? -1 : 1;
    return (b.translation?.length ?? 0) - (a.translation?.length ?? 0);
  });
  const keep = new Set(ranked.slice(0, limit));
  return {
    selected: usable.filter((cds) => keep.has(cds)),
    tooShort,
    tooLong,
    overLimit: usable.filter((cds) => !keep.has(cds)).map((cds) => cds.locusTag),
  };
}

export function cdsFasta(record: GenbankRecord, only?: GenbankCds[]): string {
  return (only ?? record.cdsFeatures)
    .filter((cds) => cds.translation)
    .map((cds) => `>${cds.locusTag}\n${cds.translation}`)
    .join('\n');
}

export function originFasta(record: GenbankRecord): string {
  return record.origin ? `>${record.locus}\n${record.origin}` : '';
}
