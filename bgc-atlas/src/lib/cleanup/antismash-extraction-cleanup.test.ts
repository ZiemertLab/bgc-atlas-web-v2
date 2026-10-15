import { describe, it, expect } from 'vitest';
import {
  selectEvictions,
  DEFAULT_TTL_MS,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_FILES,
  DEFAULT_INCOMPLETE_GRACE_MS,
  type ExtractionEntry,
  type EvictionPolicy,
} from './antismash-extraction-cleanup';

const NOW = 1_800_000_000_000;
const GB = 1024 * 1024 * 1024;
const HOUR = 60 * 60 * 1000;

const policy = (overrides: Partial<EvictionPolicy> = {}): EvictionPolicy => ({
  ttlMs: DEFAULT_TTL_MS,
  maxBytes: DEFAULT_MAX_BYTES,
  maxFiles: DEFAULT_MAX_FILES,
  incompleteGraceMs: DEFAULT_INCOMPLETE_GRACE_MS,
  now: NOW,
  ...overrides,
});

const entry = (overrides: Partial<ExtractionEntry> & { runId: string }): ExtractionEntry => ({
  bytes: 100 * 1024 * 1024,
  files: 300,
  lastServedMs: NOW,
  complete: true,
  inFlight: false,
  ...overrides,
});

describe('selectEvictions — age', () => {
  it('keeps a run served inside the TTL', () => {
    const entries = [entry({ runId: 'a', lastServedMs: NOW - 2 * HOUR })];
    expect(selectEvictions(entries, policy())).toEqual([]);
  });

  it('evicts a run not served within the TTL', () => {
    const entries = [entry({ runId: 'a', lastServedMs: NOW - 30 * HOUR })];
    expect(selectEvictions(entries, policy())).toEqual(['a']);
  });

  it('measures age from the LAST SERVE, not the extraction', () => {
    // Recently served is hot even if extracted long ago.
    const entries = [entry({ runId: 'hot', lastServedMs: NOW - 60_000 })];
    expect(selectEvictions(entries, policy())).toEqual([]);
  });
});

describe('selectEvictions — in-flight and partial directories', () => {
  it('never evicts an in-flight extraction, however old it looks', () => {
    // Deleting a directory out from under `tar -xzf` is the ENOTEMPTY race.
    const entries = [
      entry({ runId: 'a', inFlight: true, complete: false, lastServedMs: NOW - 99 * HOUR }),
    ];
    expect(selectEvictions(entries, policy())).toEqual([]);
  });

  it('leaves a young unmarked directory alone', () => {
    // No marker yet almost always means tar is still running.
    const entries = [entry({ runId: 'a', complete: false, lastServedMs: NOW - HOUR })];
    expect(selectEvictions(entries, policy())).toEqual([]);
  });

  it('reaps an unmarked directory past the grace period', () => {
    // A crash leftover can never be served.
    const entries = [entry({ runId: 'a', complete: false, lastServedMs: NOW - 7 * HOUR })];
    expect(selectEvictions(entries, policy())).toEqual(['a']);
  });

  it('does not count an unmarked directory toward the size cap', () => {
    // Its byte figure is unknown, so it must not drive evictions.
    const entries = [
      entry({ runId: 'partial', complete: false, bytes: 0, lastServedMs: NOW - HOUR }),
      entry({ runId: 'a', bytes: 1 * GB, lastServedMs: NOW - 3 * HOUR }),
      entry({ runId: 'b', bytes: 1 * GB, lastServedMs: NOW - HOUR }),
    ];
    expect(selectEvictions(entries, policy({ maxBytes: 3 * GB }))).toEqual([]);
  });
});

describe('selectEvictions — size cap', () => {
  it('evicts coldest-first until the cache fits', () => {
    const entries = [
      entry({ runId: 'coldest', bytes: 1 * GB, lastServedMs: NOW - 5 * HOUR }),
      entry({ runId: 'middle', bytes: 1 * GB, lastServedMs: NOW - 3 * HOUR }),
      entry({ runId: 'hot', bytes: 1 * GB, lastServedMs: NOW - HOUR }),
    ];
    expect(selectEvictions(entries, policy({ maxBytes: 2 * GB }))).toEqual(['coldest']);
  });

  it('keeps evicting while still over the cap', () => {
    const entries = [
      entry({ runId: 'coldest', bytes: 2 * GB, lastServedMs: NOW - 5 * HOUR }),
      entry({ runId: 'middle', bytes: 2 * GB, lastServedMs: NOW - 3 * HOUR }),
      entry({ runId: 'hot', bytes: 1 * GB, lastServedMs: NOW - HOUR }),
    ];
    expect(selectEvictions(entries, policy({ maxBytes: 2 * GB }))).toEqual(['coldest', 'middle']);
  });

  it('spares the most recently served run even when it alone busts the cap', () => {
    // One MFD run (~4.4 GB) exceeds the cap alone; the most recently served is exempt.
    const entries = [entry({ runId: 'mfd', bytes: 4.4 * GB, lastServedMs: NOW - 60_000 })];
    expect(selectEvictions(entries, policy({ maxBytes: 4 * GB }))).toEqual([]);
  });

  it('still sheds the colder runs around an oversized hot one', () => {
    const entries = [
      entry({ runId: 'cold', bytes: 1 * GB, lastServedMs: NOW - 5 * HOUR }),
      entry({ runId: 'mfd', bytes: 4.4 * GB, lastServedMs: NOW - 60_000 }),
    ];
    expect(selectEvictions(entries, policy({ maxBytes: 4 * GB }))).toEqual(['cold']);
  });

  it('does not evict when the cache is under the cap', () => {
    const entries = [
      entry({ runId: 'a', bytes: 1 * GB, lastServedMs: NOW - 5 * HOUR }),
      entry({ runId: 'b', bytes: 1 * GB, lastServedMs: NOW - HOUR }),
    ];
    expect(selectEvictions(entries, policy({ maxBytes: 4 * GB }))).toEqual([]);
  });
});

describe('selectEvictions — combined', () => {
  it('applies age first, then the cap to what is left', () => {
    const entries = [
      entry({ runId: 'stale', bytes: 1 * GB, lastServedMs: NOW - 30 * HOUR }),
      entry({ runId: 'cold', bytes: 3 * GB, lastServedMs: NOW - 5 * HOUR }),
      entry({ runId: 'hot', bytes: 1 * GB, lastServedMs: NOW - HOUR }),
    ];
    // `stale` goes on age; the remaining 4 GB then exceeds a 2 GB cap, so
    // `cold` goes too, and `hot` is exempt as the most recently served.
    expect(selectEvictions(entries, policy({ maxBytes: 2 * GB }))).toEqual(['stale', 'cold']);
  });

  it('returns nothing for an empty cache', () => {
    expect(selectEvictions([], policy())).toEqual([]);
  });
});

describe('selectEvictions — file-count cap', () => {
  it('evicts on inodes even when the cache is far under the byte cap', () => {
    // Three MFD-shaped runs: 25 GB, but 138,000 files.
    const entries = [
      entry({ runId: 'cold', bytes: 8.3 * GB, files: 46_018, lastServedMs: NOW - 5 * HOUR }),
      entry({ runId: 'mid', bytes: 8.3 * GB, files: 46_018, lastServedMs: NOW - 3 * HOUR }),
      entry({ runId: 'hot', bytes: 8.3 * GB, files: 46_018, lastServedMs: NOW - HOUR }),
    ];

    const doomed = selectEvictions(entries, policy({ maxBytes: 750 * GB, maxFiles: 100_000 }));

    expect(doomed).toEqual(['cold']);
  });

  it('keeps a hundred small runs that a byte cap would never touch', () => {
    // GTDB-shaped: 100 runs of 29 MB/~100 files fit both caps.
    const entries = Array.from({ length: 100 }, (_, i) =>
      entry({
        runId: `run-${i}`,
        bytes: 29 * 1024 * 1024,
        files: 100,
        lastServedMs: NOW - i * 60_000,
      }),
    );

    expect(selectEvictions(entries, policy({ maxFiles: 500_000 }))).toEqual([]);
  });

  it('applies whichever cap binds first', () => {
    const entries = [
      entry({ runId: 'cold', bytes: 1 * GB, files: 40_000, lastServedMs: NOW - 5 * HOUR }),
      entry({ runId: 'hot', bytes: 1 * GB, files: 40_000, lastServedMs: NOW - HOUR }),
    ];

    expect(selectEvictions(entries, policy({ maxBytes: 10 * GB, maxFiles: 50_000 }))).toEqual([
      'cold',
    ]);
    expect(selectEvictions(entries, policy({ maxBytes: 1 * GB, maxFiles: 500_000 }))).toEqual([
      'cold',
    ]);
    expect(selectEvictions(entries, policy({ maxBytes: 10 * GB, maxFiles: 500_000 }))).toEqual([]);
  });

  it('spares the most recently served run even when it alone busts the file cap', () => {
    // Same most-recently-served exemption as the byte cap.
    const entries = [entry({ runId: 'mfd', bytes: 8.3 * GB, files: 46_018, lastServedMs: NOW })];
    expect(selectEvictions(entries, policy({ maxFiles: 10_000 }))).toEqual([]);
  });

  it('ignores an unmeasured run, which counts as zero files', () => {
    // A run not yet measured must not trigger eviction.
    const entries = [
      entry({ runId: 'unmeasured', bytes: 0, files: 0, lastServedMs: NOW - 5 * HOUR }),
      entry({ runId: 'hot', bytes: 1 * GB, files: 1_000, lastServedMs: NOW - HOUR }),
    ];
    expect(selectEvictions(entries, policy({ maxFiles: 500_000 }))).toEqual([]);
  });
});
