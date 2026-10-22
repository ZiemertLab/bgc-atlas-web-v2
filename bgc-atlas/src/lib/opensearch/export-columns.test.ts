import { describe, expect, it } from 'vitest';

import { serializeDelimited } from './export-columns';

describe('Property Search delimited export', () => {
  const columns = [{ key: 'sample_name', label: 'Sample' }, { key: 'length', label: 'Length (bp)' }];

  it('uses the shared escaper: formulas neutralised, \\r quoted, numbers left alone', () => {
    const out = serializeDelimited([{ sample_name: '=cmd()', length: -5 }, { sample_name: 'a\rb', length: 10 }], columns, ',');
    expect(out).toBe(`Sample,Length (bp)\n'=cmd(),-5\n"a\rb",10\n`);
  });

  it('ends with a newline, as the other exports do', () => {
    expect(serializeDelimited([], columns, '\t').endsWith('\n')).toBe(true);
  });
});
