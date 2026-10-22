import { createHash } from 'crypto';

export interface FastaSequence {
  header: string;
  sequence: string;
  length: number;
}

export interface FastaValidationResult {
  valid: boolean;
  sequenceType: 'nucleotide' | 'protein' | 'unknown';
  error?: string;
  sequences: FastaSequence[];
}

export const MAX_SEQUENCES = 100;

export const DEFAULT_HEADER = 'query';

export function normalizeToFasta(input: string): string {
  const trimmed = input.replace(/\r\n?/g, '\n').trim();
  if (!trimmed) return trimmed;
  const withHeader = trimmed.startsWith('>') ? trimmed : `>${DEFAULT_HEADER}\n${trimmed}`;
  return withQueryIds(withHeader);
}

/**
 * Give every record an id DIAMOND can report.
 *
 * DIAMOND's query id is the header's first word, so "> kcn" -- a space after the
 * '>', common in hand-typed headers -- is reported as an EMPTY id: every output row
 * then starts with a tab, and a search that had run to completion was lost when its
 * results could not be stored. Leading
 * whitespace after '>' is removed, and a header with nothing after it is named
 * query_<n>. A header that already starts with its id is returned unchanged, so clean
 * input keeps its bytes and with them its sequence hash.
 */
function withQueryIds(fasta: string): string {
  let record = 0;
  return fasta
    .split('\n')
    .map((line) => {
      const start = line.trimStart();
      if (!start.startsWith('>')) return line;
      record += 1;
      const rest = start.slice(1).trimStart();
      return rest ? `>${rest}` : `>${DEFAULT_HEADER}_${record}`;
    })
    .join('\n');
}

// Nucleotide bounds are the protein bounds in codons.
export const LENGTH_BOUNDS = {
  protein: { min: 10, max: 10_000, unit: 'amino acids' },
  nucleotide: { min: 30, max: 30_000, unit: 'nucleotides' },
} as const;

/** The query id DIAMOND reports for a header: its first word, after the '>'. */
const queryId = (header: string) => header.slice(1).trim().split(/\s+/)[0];

function parseSequences(trimmed: string): FastaSequence[] {
  const sequences: FastaSequence[] = [];
  let currentHeader = '';
  let currentSequence = '';

  const push = () => {
    if (currentHeader && currentSequence) {
      sequences.push({ header: currentHeader, sequence: currentSequence, length: currentSequence.length });
    }
  };

  for (const line of trimmed.split('\n')) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    if (trimmedLine.startsWith('>')) {
      push();
      currentHeader = trimmedLine;
      currentSequence = '';
    } else {
      currentSequence += trimmedLine;
    }
  }
  push();

  return sequences;
}

// Nucleotide wins ties, since ATGC are also valid amino-acid letters.
function detectType(sequences: FastaSequence[]): 'nucleotide' | 'protein' | 'unknown' {
  let nucleotideCount = 0;
  let proteinCount = 0;

  for (const seq of sequences) {
    const upperSeq = seq.sequence.toUpperCase();
    const nucChars = (upperSeq.match(/[ATGCN]/g) || []).length;
    const protChars = (upperSeq.match(/[ACDEFGHIKLMNPQRSTVWY]/g) || []).length;

    if (nucChars / upperSeq.length > 0.85) nucleotideCount++;
    else if (protChars / upperSeq.length > 0.85) proteinCount++;
  }

  if (nucleotideCount === sequences.length) return 'nucleotide';
  if (proteinCount === sequences.length) return 'protein';
  return 'unknown';
}

export function validateFastaSequence(sequence: string): FastaValidationResult {
  const trimmed = sequence.trim();

  if (!trimmed) {
    return { valid: false, error: 'Sequence is empty', sequenceType: 'unknown', sequences: [] };
  }

  if (!trimmed.startsWith('>')) {
    return {
      valid: false,
      error: 'FASTA format must start with ">" header line',
      sequenceType: 'unknown',
      sequences: [],
    };
  }

  const sequences = parseSequences(trimmed);

  if (sequences.length === 0) {
    return { valid: false, error: 'No sequences found in FASTA format', sequenceType: 'unknown', sequences: [] };
  }

  // DIAMOND names each query by the first word of its header, so two records that
  // share one are reported as a single query with both sets of hits merged.
  const seenIds = new Set<string>();
  for (const seq of sequences) {
    const id = queryId(seq.header);
    if (seenIds.has(id)) {
      return {
        valid: false,
        error: `More than one sequence has the id "${id}". Results are reported by the first word `
          + 'of each header, so give every sequence its own.',
        sequenceType: 'unknown',
        sequences,
      };
    }
    seenIds.add(id);
  }

  if (sequences.length > MAX_SEQUENCES) {
    return {
      valid: false,
      error: `Too many sequences (${sequences.length}). Maximum ${MAX_SEQUENCES} sequences allowed per submission.`,
      sequenceType: 'unknown',
      sequences,
    };
  }

  const sequenceType = detectType(sequences);
  if (sequenceType === 'unknown') {
    return {
      valid: false,
      error: 'Mixed or ambiguous sequence types detected. All sequences must be either nucleotide or protein.',
      sequenceType: 'unknown',
      sequences,
    };
  }

  const { min, max, unit } = LENGTH_BOUNDS[sequenceType];
  for (const seq of sequences) {
    if (seq.length < min) {
      return {
        valid: false,
        error: `Sequence "${seq.header}" is too short (${seq.length}). Minimum length is ${min} ${unit}.`,
        sequenceType,
        sequences,
      };
    }
    if (seq.length > max) {
      return {
        valid: false,
        error: `Sequence "${seq.header}" is too long (${seq.length}). Maximum length is ${max.toLocaleString('en-US')} ${unit}.`,
        sequenceType,
        sequences,
      };
    }
  }

  if (sequenceType === 'nucleotide') {
    for (const seq of sequences) {
      const invalidChars = seq.sequence.toUpperCase().replace(/[ATGCN\s]/g, '');
      if (invalidChars.length > 0) {
        return {
          valid: false,
          error: `Invalid nucleotide characters in sequence "${seq.header}": ${invalidChars.slice(0, 10)}${invalidChars.length > 10 ? '...' : ''}`,
          sequenceType,
          sequences,
        };
      }
    }
  }

  return { valid: true, sequenceType, sequences };
}

export function calculateSequenceHash(input: string): string {
  return createHash('sha256').update(input.trim()).digest('hex');
}
