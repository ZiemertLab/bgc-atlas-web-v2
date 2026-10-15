'use client';

import React, { useState } from 'react';

import { cn } from '@/lib/utils';
import { TOOLTIP_CLASSES, formatCompactCount } from '@/lib/utils/chart-utils';

/** One row. `value` is the whole bar; `partial` (optional) is the hatched share of it. */
export interface HorizontalBarDatum {
  key: string;
  /** Text beside the bar. Truncated to the label column; `title` carries the rest. */
  label: string;
  value: number;
  /** Portion of `value` drawn hatched (BGCs on a contig edge). */
  partial?: number;
  color: string;
  /** First tooltip line; defaults to `label`. Use it for a full GOLD path. */
  title?: string;
  /** Tooltip lines under the title, already formatted. Defaults to the exact value. */
  details?: string[];
}

interface HorizontalBarChartProps {
  data: HorizontalBarDatum[];
  /** Text beside the bar. Defaults to formatCompactCount ("4.7M", "3,683"). */
  formatValue?: (d: HorizontalBarDatum) => string;
  /** Row click, e.g. /gcfs sets the category filter. Rows become buttons. */
  onSelect?: (d: HorizontalBarDatum) => void;
  /** Accessible name for the list. */
  label: string;
  className?: string;
  /**
   * Spread the rows over the parent's height instead of packing them at the
   * top: for a bar card that sits beside a sunburst and must end where it does.
   * The parent must give the chart a height (e.g. flex-1 in a stretched card).
   */
  fill?: boolean;
}

/**
 * Diagonal hatch in `color`, the CSS twin of the SVG pattern the vertical bars
 * used (2px stroke every 4px, 45°). Exported so legends draw the same swatch.
 */
export function hatchBackground(color: string): string {
  return `repeating-linear-gradient(-45deg, ${color} 0 2px, transparent 2px 4px)`;
}

/**
 * The canonical bar chart for categorical counts. Horizontal because the
 * categories are words: GOLD paths, product classes, taxa. Drawn vertically they
 * were tilted 45° and, at GOLD level 3, overlapped. Every bar carries its value,
 * so there are no gridlines to read it from.
 *
 * Plain HTML rather than d3: it sizes to its container without measuring, has no
 * redraw on resize, and a bar under a pixel still shows its number.
 */
export function HorizontalBarChart({ data, formatValue, onSelect, label, className, fill = false }: HorizontalBarChartProps) {
  const [tip, setTip] = useState<{ d: HorizontalBarDatum; x: number; y: number } | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const valueText = formatValue ?? ((d: HorizontalBarDatum) => formatCompactCount(d.value));

  const showTip = (d: HorizontalBarDatum) => (event: React.MouseEvent) =>
    setTip({ d, x: event.clientX, y: event.clientY });

  return (
    <div className={cn('@container relative', fill && 'flex flex-col', className)}>
      <ul
        aria-label={label}
        // Narrow (a phone, or a half-width card on a small laptop): each label on
        // its own line above its bar, so a GOLD path is not cut to a word.
        // From 28rem: label | bar | value. fit-content(40%) makes the label column
        // as wide as the longest label, up to 40%, so "RiPP" does not waste a
        // third of the width and a long path cannot squeeze the bars out.
        className={cn(
          'grid grid-cols-[minmax(0,1fr)_max-content] items-center gap-x-2 gap-y-1 text-xs @md:grid-cols-[fit-content(40%)_minmax(0,1fr)_max-content] @md:gap-y-1.5',
          fill && 'flex-1 content-between',
        )}
      >
        {data.map((d) => {
          const partial = Math.min(d.partial ?? 0, d.value);
          const complete = d.value - partial;
          // A real count never draws as nothing: at least a hairline.
          const width = d.value > 0 ? `max(1px, ${(d.value / max) * 100}%)` : '0';
          const row = (
            <>
              <span className="col-span-2 min-w-0 truncate text-left text-foreground @md:col-span-1 @md:text-right">{d.label}</span>
              <span className="flex h-4 min-w-0 items-stretch">
                <span className="flex h-full overflow-hidden rounded-[2px]" style={{ width }}>
                  {complete > 0 && (
                    <span className="h-full" style={{ flexGrow: complete, backgroundColor: d.color }} />
                  )}
                  {partial > 0 && (
                    <span className="h-full" style={{ flexGrow: partial, background: hatchBackground(d.color) }} />
                  )}
                </span>
              </span>
              <span className="text-right font-mono tabular-nums text-muted-foreground">{valueText(d)}</span>
            </>
          );
          const hover = {
            onMouseEnter: showTip(d),
            onMouseMove: showTip(d),
            onMouseLeave: () => setTip(null),
          };
          return (
            <li key={d.key} className="col-span-2 grid grid-cols-subgrid items-center @md:col-span-3">
              {onSelect ? (
                <button
                  type="button"
                  className="col-span-2 -mx-1 grid cursor-pointer grid-cols-subgrid items-center rounded-sm px-1 py-px text-left hover:bg-muted/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring @md:col-span-3"
                  onClick={() => onSelect(d)}
                  {...hover}
                >
                  {row}
                </button>
              ) : (
                <div className="col-span-2 grid grid-cols-subgrid items-center @md:col-span-3" {...hover}>
                  {row}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {tip && (
        <div
          className={cn(TOOLTIP_CLASSES, 'max-w-64')}
          // Bars sit at the right of the page, so near the right edge the tip
          // opens leftward instead of running off the window.
          // Anchored by its right edge then, and never wider than the room to
          // the cursor's left, so on a phone it does not run off that side.
          style={
            tip.x > window.innerWidth - 280
              ? { right: window.innerWidth - tip.x + 14, top: tip.y - 12, maxWidth: Math.max(160, tip.x - 22) }
              : { left: tip.x + 14, top: tip.y - 12 }
          }
          role="tooltip"
        >
          <div className="font-medium">{tip.d.title ?? tip.d.label}</div>
          {(tip.d.details ?? [tip.d.value.toLocaleString()]).map((line) => (
            <div key={line} className="tabular-nums">{line}</div>
          ))}
        </div>
      )}
    </div>
  );
}
