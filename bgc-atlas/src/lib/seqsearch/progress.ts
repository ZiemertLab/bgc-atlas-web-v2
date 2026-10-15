import { readFile } from 'fs/promises';
import { join } from 'path';

// Must match the submit route's SESSION_DIR.
const SESSION_DIR = process.env.SESSION_DIR || '/tmp/sessions';

export interface DiamondProgress {
  queryBlock: number;
  /** 1-based. */
  refBlock: number;
  refBlocks: number;
  /** 0..1; the current block counts as half done. Blocks differ in cost, so not a time estimate. */
  fraction: number;
}

// "Processing query block 1, reference block 3/5, shape 1/2."
const BLOCK_LINE = /Processing query block (\d+), reference block (\d+)\/(\d+), shape \d+\/\d+/g;

// Null during the opening phase (index loading); callers stay indeterminate until then.
export function parseDiamondProgress(log: string): DiamondProgress | null {
  const matches = [...log.matchAll(BLOCK_LINE)];
  const last = matches[matches.length - 1];
  if (!last) return null;

  const queryBlock = Number(last[1]);
  const refBlock = Number(last[2]);
  const refBlocks = Number(last[3]);
  if (!refBlocks || refBlock > refBlocks) return null;

  return {
    queryBlock,
    refBlock,
    refBlocks,
    fraction: Math.min(1, Math.max(0, (refBlock - 0.5) / refBlocks)),
  };
}

// Best-effort: a missing log reads as "no progress yet", never an error.
export async function readDiamondProgress(sessionId: string): Promise<DiamondProgress | null> {
  try {
    const log = await readFile(join(SESSION_DIR, sessionId, 'diamond.log'), 'utf8');
    return parseDiamondProgress(log);
  } catch {
    return null;
  }
}
