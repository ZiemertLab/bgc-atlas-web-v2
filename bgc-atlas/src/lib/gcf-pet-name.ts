// Human-readable GCF aliases. Display-only: never a URL segment or identifier.
//
// Node/script-only; do not import from src/app or client components. The wordlists
// are read from disk at import time and are not traced into Next's output, so an
// import 500s the route. The app reads the gcfs.pet_name column instead.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolved relative to this module; importing scripts may run from any cwd.
const WORDLIST_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'wordlists/petname');

const readList = (file: string): string[] =>
  fs
    .readFileSync(path.join(WORDLIST_DIR, file), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

/**
 * petname `medium` tier, vendored unmodified. Apache-2.0 — see the repo-root
 * NOTICE and wordlists/petname/{LICENSE,README.md}. Frozen: the order defines the
 * published mapping, so re-sorting would re-alias families.
 */
export const ADJECTIVES: readonly string[] = Object.freeze(readList('adjectives.txt'));
export const NOUNS: readonly string[] = Object.freeze(readList('names.txt'));

/** 1198 x 1052 = 1,260,296 — strictly larger than the 999,999 id ceiling. */
const N = ADJECTIVES.length * NOUNS.length;

// Knuth's constant, coprime to N = 2^3 * 263 * 599, so id -> x is a bijection.
// BigInt(...) rather than a literal: tsconfig targets ES2017 (TS2737).
const K = BigInt(2654435761);

/** The canonical name carries exactly 6 digits, so ids stop at 999,999. */
const MAX_ID = 999_999;

// Release-tagged names, `GCF-v2b6-000042` / `GCF-v2b6-F-400042`, plus the untagged v3 and legacy v2
// (GCF-04-000042, GCF-CC-04-400042) shapes; the tag never looks like the v2 `\d{2}-` segment, so the
// shapes are disjoint. Each clustering's aliases are drawn after PET_OFFSET[tag], so they differ from
// the previous clustering's for the same number; a dropped clustering's offset stays reserved.
// Keep in step with _NAME_PATTERN and PET_OFFSET in scripts/clustering-v3/gcf_pet_name.py.
const NAME_PATTERN = /^GCF-(?:(v\d+(?:\.\d+)?(?:[ab]\d+)?)-)?(?:(?:CC-)?\d{2}-|F-)?(\d{6})$/;

/** Offset into the alias space per clustering, by name tag ('' = the August v3 clustering). */
export const PET_OFFSET: Readonly<Record<string, number>> = {
  '': 0, v2b2: 794_186, v2b4: 1_586_754, v2b5: 2_379_180, v2b6: 3_174_143,
};

export function petNameForId(id: number, offset = 0): string {
  if (!Number.isInteger(id) || id < 1 || id > MAX_ID) {
    throw new RangeError(`GCF id out of representable range (1..${MAX_ID}): ${id}`);
  }
  const x = Number((BigInt(id + offset) * K) % BigInt(N));
  return `${ADJECTIVES[x % ADJECTIVES.length]}-${NOUNS[Math.floor(x / ADJECTIVES.length)]}`;
}

// Null rather than throwing: a malformed name should leave the badge unrendered.
export function petNameForGcfName(gcfName: string | null | undefined): string | null {
  const match = gcfName?.match(NAME_PATTERN);
  if (!match) return null;
  const offset = PET_OFFSET[match[1] ?? ''];
  if (offset === undefined) return null;
  const id = Number(match[2]);
  return id >= 1 && id <= MAX_ID ? petNameForId(id, offset) : null;
}
