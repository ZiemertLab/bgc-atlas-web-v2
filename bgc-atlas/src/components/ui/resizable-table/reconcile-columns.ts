import type { TableColumn } from './types';

/**
 * The table's internal columns brought in line with a new prop set.
 *
 * A column still in the prop keeps its internal state -- the reader's order,
 * width and visibility. A column no longer in the prop is dropped. A new one is
 * taken from the prop as it is (its `visible` is the page's call, which is how a
 * page re-applies a reader's earlier Columns choice) and placed right after the
 * nearest column that precedes it in the prop, or first when none does.
 */
export function reconcileColumns<T>(current: TableColumn<T>[], next: TableColumn<T>[]): TableColumn<T>[] {
  const nextIds = new Set(next.map((c) => c.id));
  const out = current.filter((c) => nextIds.has(c.id));
  const have = new Set(out.map((c) => c.id));
  next.forEach((column, index) => {
    if (have.has(column.id)) return;
    let at = 0;
    for (let i = index - 1; i >= 0; i -= 1) {
      const before = out.findIndex((c) => c.id === next[i].id);
      if (before !== -1) {
        at = before + 1;
        break;
      }
    }
    out.splice(at, 0, column);
    have.add(column.id);
  });
  return out;
}
