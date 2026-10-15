import { describe, expect, it } from 'vitest';

import {
  chooseViewerDir,
  findAntismashIndex,
  isPrescreenDir,
  rankResultsJsonCandidates,
} from './antismash-viewer-select';

// Converted MGnify tarballs hold two antiSMASH outputs (`<name>_basic/` prescreen and `<name>/`)
// with different record numbering; this must agree with select_regions_js in anchors.py.

describe('isPrescreenDir', () => {
  it('matches a directory whose name ends in _basic', () => {
    expect(isPrescreenDir('MGYA00238072_ERZ650159/MGYA00238072_ERZ650159_basic')).toBe(true);
  });

  it('does not match the real run directory', () => {
    expect(isPrescreenDir('MGYA00238072_ERZ650159/MGYA00238072_ERZ650159')).toBe(false);
  });

  it('only matches the exact _basic suffix', () => {
    expect(isPrescreenDir('run/run_basics')).toBe(false);
    expect(isPrescreenDir('run/basic')).toBe(false);
  });

  it('handles a bare directory with no parent', () => {
    expect(isPrescreenDir('')).toBe(false);
    expect(isPrescreenDir('run_basic')).toBe(true);
  });
});

describe('chooseViewerDir', () => {
  const FULL = 'MGYA00238072_ERZ650159/MGYA00238072_ERZ650159';
  const BASIC = 'MGYA00238072_ERZ650159/MGYA00238072_ERZ650159_basic';

  it('prefers the real run when the prescreen is listed first', () => {
    expect(chooseViewerDir([BASIC, FULL])).toBe(FULL);
  });

  it('prefers the real run when the prescreen is listed second', () => {
    expect(chooseViewerDir([FULL, BASIC])).toBe(FULL);
  });

  it('is independent of input order', () => {
    // readdir order is filesystem hash order, so input order must not matter.
    expect(chooseViewerDir([BASIC, FULL])).toBe(chooseViewerDir([FULL, BASIC]));
  });

  it('falls back to the prescreen when it is the only viewer', () => {
    expect(chooseViewerDir([BASIC])).toBe(BASIC);
  });

  it('returns null when there are no candidates', () => {
    expect(chooseViewerDir([])).toBeNull();
  });

  it('breaks ties by shallowest path then lexicographically', () => {
    const dirs = ['run/b/deeper', 'run/a', 'run/b'];
    expect(chooseViewerDir(dirs)).toBe('run/a');
    expect(chooseViewerDir([...dirs].reverse())).toBe('run/a');
  });

  it('handles a viewer at the extraction root', () => {
    expect(chooseViewerDir([''])).toBe('');
  });
});

describe('rankResultsJsonCandidates', () => {
  // The prescreen's `<name>.json` is larger than the real run's `<name>_regions.json`.
  const basicJson = { filePath: 'run/run_basic/MGYA00701287_ERZ652695.json', size: 87_374_567 };
  const fullJson = { filePath: 'run/run/MGYA00701287_ERZ652695_regions.json', size: 7_484_487 };

  it('puts the real run ahead of the much larger prescreen JSON', () => {
    expect(rankResultsJsonCandidates([basicJson, fullJson])[0].filePath).toBe(fullJson.filePath);
  });

  it('de-prefers the prescreen even when it also matches _regions.json', () => {
    const basicRegions = { filePath: 'run/run_basic/x_regions.json', size: 99_000_000 };
    const full = { filePath: 'run/run/y.json', size: 10 };
    expect(rankResultsJsonCandidates([basicRegions, full])[0].filePath).toBe(full.filePath);
  });

  it('still prefers _regions.json then larger within the same directory class', () => {
    const a = { filePath: 'run/run/small_regions.json', size: 10 };
    const b = { filePath: 'run/run/huge.json', size: 1_000_000 };
    const c = { filePath: 'run/run/other.json', size: 500 };
    const ranked = rankResultsJsonCandidates([c, b, a]).map(x => x.filePath);
    expect(ranked).toEqual([a.filePath, b.filePath, c.filePath]);
  });

  it('keeps the prescreen as a last resort rather than dropping it', () => {
    expect(rankResultsJsonCandidates([basicJson]).map(x => x.filePath)).toEqual([basicJson.filePath]);
  });
});

describe('findAntismashIndex', () => {
  const mkTree = async (spec: Record<string, string>) => {
    const { mkdtemp, mkdir, writeFile } = await import('fs/promises');
    const { tmpdir } = await import('os');
    const nodePath = (await import('path')).default;
    const root = await mkdtemp(nodePath.join(tmpdir(), 'as-viewer-'));
    for (const [rel, body] of Object.entries(spec)) {
      const full = nodePath.join(root, rel);
      await mkdir(nodePath.dirname(full), { recursive: true });
      await writeFile(full, body);
    }
    return root;
  };

  it('serves the real run, not the prescreen, on a dual-viewer tree', async () => {
    // The layout of MGYA00238072_ERZ650159, the reported case.
    const root = await mkTree({
      'RUN/RUN/index.html': '', 'RUN/RUN/regions.html': '', 'RUN/RUN/regions.js': '',
      'RUN/RUN_basic/index.html': '', 'RUN/RUN_basic/regions.js': '',
    });
    expect(await findAntismashIndex(root)).toEqual({
      relativeIndexPath: 'RUN/RUN/index.html',
      relativeRegionsPath: 'RUN/RUN/regions.html',
    });
  });

  it('takes regions.html from the chosen viewer, never the other one', async () => {
    // Only the prescreen has a regions.html: the real run still wins and reports null.
    const root = await mkTree({
      'RUN/RUN/index.html': '',
      'RUN/RUN_basic/index.html': '', 'RUN/RUN_basic/regions.html': '',
    });
    expect(await findAntismashIndex(root)).toEqual({
      relativeIndexPath: 'RUN/RUN/index.html',
      relativeRegionsPath: null,
    });
  });

  it('falls back to the prescreen when it is the only viewer', async () => {
    const root = await mkTree({ 'RUN/RUN_basic/index.html': '' });
    expect((await findAntismashIndex(root))?.relativeIndexPath).toBe('RUN/RUN_basic/index.html');
  });

  it('handles a single-viewer run unchanged', async () => {
    const root = await mkTree({ 'RUN/RUN/index.html': '', 'RUN/RUN/regions.html': '' });
    expect((await findAntismashIndex(root))?.relativeIndexPath).toBe('RUN/RUN/index.html');
  });

  it('handles a viewer at the extraction root', async () => {
    const root = await mkTree({ 'index.html': '', 'regions.html': '' });
    expect(await findAntismashIndex(root)).toEqual({
      relativeIndexPath: 'index.html',
      relativeRegionsPath: 'regions.html',
    });
  });

  it('returns null when there is no viewer at all', async () => {
    const root = await mkTree({ 'RUN/notes.txt': '' });
    expect(await findAntismashIndex(root)).toBeNull();
  });

  it('does not descend past the shallowest viewer', async () => {
    // A deeper index.html must not be considered once a shallower one exists.
    const root = await mkTree({
      'RUN/RUN/index.html': '',
      'RUN/RUN/knownclusterblast/region1/index.html': '',
    });
    expect((await findAntismashIndex(root))?.relativeIndexPath).toBe('RUN/RUN/index.html');
  });
});
