import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

import { ALL_FIELD_NAMES, NUMERIC_FIELDS } from './constants';

// SampleMetadata's field types, read from its declaration (types are not there at
// runtime). The contribute form picks a number input from NUMERIC_FIELDS, so the two
// must agree: a text field in the set cannot be typed into at all.
function sampleMetadataTypes(): Map<string, string> {
  const src = readFileSync(join(__dirname, 'types.ts'), 'utf8');
  const start = src.indexOf('interface SampleMetadata');
  const body = src.slice(start, src.indexOf('\n}', start));
  return new Map([...body.matchAll(/^\s+([a-z_]+)\??:\s*([^;]+);/gm)].map((m) => [m[1], m[2].trim()]));
}

describe('NUMERIC_FIELDS', () => {
  const types = sampleMetadataTypes();

  it('is exactly the number fields of SampleMetadata', () => {
    const numeric = ALL_FIELD_NAMES.filter((f) => /\bnumber\b/.test(types.get(f) ?? ''));
    expect([...NUMERIC_FIELDS].sort()).toEqual([...numeric].sort());
  });

  it.each(['geographic_location', 'salinity_unit', 'geolocation_name', 'host_scientific_name'])(
    'leaves %s a text field',
    (field) => {
      expect(NUMERIC_FIELDS.has(field)).toBe(false);
    },
  );
});
