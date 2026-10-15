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
  const trimmed = input.trim();
  if (!trimmed || trimmed.startsWith('>')) return trimmed;
  return `>${DEFAULT_HEADER}\n${trimmed}`;
}

// Nucleotide bounds are the protein bounds in codons.
export const LENGTH_BOUNDS = {
  protein: { min: 10, max: 10_000, unit: 'amino acids' },
  nucleotide: { min: 30, max: 30_000, unit: 'nucleotides' },
} as const;

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
