import { describe, expect, it } from 'vitest';

import { reconcileColumns } from './reconcile-columns';
import type { TableColumn } from './types';

const col = (id: string, extra: Partial<TableColumn<unknown>> = {}): TableColumn<unknown> => ({ id, label: id, ...extra });
const ids = (columns: TableColumn<unknown>[]) => columns.map((c) => c.id);

describe('reconcileColumns', () => {
  it('inserts a new column after the one it follows in the prop', () => {
    const out = reconcileColumns([col('a'), col('b'), col('c')], [col('a'), col('b'), col('m'), col('c')]);
    expect(ids(out)).toEqual(['a', 'b', 'm', 'c']);
  });

  it('keeps the reader’s order, widths and visibility for columns that stay', () => {
    const current = [col('c', { width: 300 }), col('a', { visible: false }), col('b')];
    const out = reconcileColumns(current, [col('a'), col('m'), col('b'), col('c')]);
    expect(ids(out)).toEqual(['c', 'a', 'm', 'b']);
    expect(out[0].width).toBe(300);
    expect(out[1].visible).toBe(false);
  });

  it('takes a new column’s visibility from the prop', () => {
    const out = reconcileColumns([col('a')], [col('a'), col('m', { visible: false })]);
    expect(out[1].visible).toBe(false);
  });

  it('drops a column the prop no longer has', () => {
    expect(ids(reconcileColumns([col('a'), col('m'), col('b')], [col('a'), col('b')]))).toEqual(['a', 'b']);
  });

  it('puts a column with no predecessor first', () => {
    expect(ids(reconcileColumns([col('a')], [col('m'), col('a')]))).toEqual(['m', 'a']);
  });
});
