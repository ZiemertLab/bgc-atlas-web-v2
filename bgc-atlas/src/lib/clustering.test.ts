import { describe, expect, it } from 'vitest';

import { canonicalGcfName, CURRENT_CLUSTERING, PREVIOUS_CLUSTERING_ORDER } from './clustering';

describe('canonicalGcfName', () => {
  it('returns stored names unchanged', () => {
    for (const name of ['GCF-000042', 'GCF-F-400042', 'GCF-v2b2-000042', 'GCF-v2b2-F-400042', 'GCF-v2b4-F-400004']) {
      expect(canonicalGcfName(name)).toBe(name);
    }
  });

  it('folds however a name was typed to the stored form', () => {
    expect(canonicalGcfName('gcf-v2b2-f-400001')).toBe('GCF-v2b2-F-400001');
    expect(canonicalGcfName('GCF-V2B4-000042')).toBe('GCF-v2b4-000042');
    expect(canonicalGcfName(' gcf-f-400042 ')).toBe('GCF-F-400042');
    expect(canonicalGcfName('gcf-cc-04-400042')).toBe('GCF-CC-04-400042');
  });

  it('rejects anything that is not a family name', () => {
    expect(canonicalGcfName('rejoicing-human')).toBeNull();
    expect(canonicalGcfName('GCF-42')).toBeNull();
    expect(canonicalGcfName('GCF-v2b4-0000042')).toBeNull();
  });
});

describe('replaced clusterings', () => {
  it('lists the newest first and never the current one', () => {
    expect(PREVIOUS_CLUSTERING_ORDER[0]).toBe('v2b4-2026-10-12');
    expect(PREVIOUS_CLUSTERING_ORDER.some((label) => label.startsWith(`${CURRENT_CLUSTERING.tag}-`))).toBe(false);
  });
});
