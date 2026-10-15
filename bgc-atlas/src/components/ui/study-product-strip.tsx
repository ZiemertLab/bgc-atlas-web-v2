'use client';

import { memo } from 'react';

import { getProductCategoryColor } from '@/lib/utils/chart-utils';

// `bgcs.product_category` is multi-label, so counts are assignments and sum past total_bgcs;
// the bar is drawn on share of assignments, not as a partition of BGCs.
export interface StudyProductStripProps {
  distribution: Record<string, number> | null;
  className?: string;
}

const fmt = (n: number) => n.toLocaleString();

function StudyProductStripComponent({ distribution, className = '' }: StudyProductStripProps) {
  const entries = Object.entries(distribution ?? {})
    .filter(([, n]) => n > 0)
    .sort(([, a], [, b]) => b - a);

  if (!entries.length) return null;

  const total = entries.reduce((sum, [, n]) => sum + n, 0);

  return (
    <div className={className}>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full" role="img"
        aria-label={entries.map(([c, n]) => `${c} ${fmt(n)}`).join(', ')}>
        {entries.map(([category, count], i) => (
          <div
            key={category}
            className="h-full"
            style={{ width: `${(count / total) * 100}%`, background: getProductCategoryColor(category, i) }}
            title={`${category}: ${fmt(count)} assignments`}
          />
        ))}
      </div>

      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {entries.map(([category, count], i) => (
          <li key={category} className="inline-flex items-center gap-1.5">
            <span
              className="h-2 w-2 shrink-0 rounded-[2px]"
              style={{ background: getProductCategoryColor(category, i) }}
              aria-hidden
            />
            <span className="text-muted-foreground">{category}</span>
            <span className="font-mono tabular-nums">{fmt(count)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const StudyProductStrip = memo(StudyProductStripComponent);
StudyProductStrip.displayName = 'StudyProductStrip';
