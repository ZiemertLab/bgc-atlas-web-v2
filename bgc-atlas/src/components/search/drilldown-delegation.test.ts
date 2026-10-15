import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { bgcPropertyFilterFields, defaultFacetFields } from '@/lib/filters/bgc-property-fields';

// A source-text guard: the unit suite runs in node with no DOM, so components cannot render.
// Both drill-down sites must get the operator from facetValueCondition, not special-case
// `is_complete` (which emitted `pks_trans_at in ['true']`).
const SRC = join(process.cwd(), 'src/components/search');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const CALL_SITES = ['distribution-panel.tsx', 'property-search-tab.tsx'];

describe('drill-down conditions are built from the catalog, not per call site', () => {
  it.each(CALL_SITES)('%s delegates to facetValueCondition', (file) => {
    expect(read(file)).toContain('facetValueCondition');
  });

  it.each(CALL_SITES)('%s does not special-case a field id to pick an operator', (file) => {
    // `field === 'is_complete' ? equals : in` in either file is the bug returning.
    const offending = read(file).match(/===\s*'is_complete'[\s\S]{0,120}?(equals|'in')/g) ?? [];
    expect(offending).toEqual([]);
  });

  it('would catch a second boolean field joining the refine panel', () => {
    // While only one default facet is boolean, a browser cannot tell a hardcoded special case
    // from the catalog. If this fails, cover the Refine drill-down in e2e instead.
    const booleanDefaults = defaultFacetFields.filter(
      (id) => bgcPropertyFilterFields.find((f) => f.id === id)?.os === 'boolean',
    );
    expect(booleanDefaults).toEqual(['is_complete']);
  });
});
