"use client";

import * as React from 'react';
import { TooltipBadge } from '@/components/ui/tooltip-badge';
import { cn } from '@/lib/utils';

interface TaxonomyBadgeProps {
  /** The taxon shown on the badge, at whatever rank the table displays. */
  name: string;
  /** The already-joined lineage, `a › b › c`; the bubble falls back to `name`. */
  lineage?: string;
  /** Phylum-keyed fill from `getTaxonomyBadgeStyle`; without one the badge is an outline. */
  style?: React.CSSProperties;
  italic?: boolean;
  /** Text size and the like, e.g. `text-xs` in tables, `text-[11px]` in Property Search. */
  className?: string;
}

/**
 * A taxon badge whose bubble shows the full lineage.
 *
 * Shared because the same block had been hand-written in four tables, each with
 * a `<span>` Badge as the tooltip trigger — unreachable by touch or keyboard, so
 * on a phone the lineage could not be read at all. This renders a
 * {@link TooltipBadge}, a real `<button>` that opens on hover, focus and tap.
 *
 * Callers build `lineage` themselves: their inputs differ (row fields, Property
 * Search hits).
 *
 * `wide` gives the bubble its viewport-capped width, `min(440px, 100vw - 2rem)`:
 * a bare `max-w-[440px]` ran off a 390px phone.
 *
 * `text-left`: a `<button>` is `text-align: center` by default and preflight
 * does not reset it, so a long name that wraps would centre its lines, where
 * the old `<span>` inherited the cell's left alignment.
 */
export function TaxonomyBadge({ name, lineage, style, italic = false, className }: TaxonomyBadgeProps) {
  return (
    <TooltipBadge
      variant={style ? 'secondary' : 'outline'}
      style={style}
      className={cn('h-auto max-w-full whitespace-normal text-left', italic && 'italic', className)}
      wide
      tooltip={<p className="text-xs leading-relaxed">{lineage || name}</p>}
    >
      {name}
    </TooltipBadge>
  );
}
