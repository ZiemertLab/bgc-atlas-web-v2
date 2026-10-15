'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartSkeleton } from '@/components/ui/chart-skeleton';
import { Loader2 } from 'lucide-react';
import { getProductCategoryColor, TOOLTIP_CLASSES } from '@/lib/utils/chart-utils';
import type { CompositionRow } from '@/lib/opensearch/taxonomy-composition';
import type { TaxonomyRank } from '@/lib/types';

// Taxon x product-category heatmap shared by /bgcs and /gcfs; each page maps its own hook's result onto the props.
// A DOM table, not SVG: SVG text cannot carry the per-cell percentages, and the old SVG overflowed at 390px.

export const RANK_LABEL: Record<TaxonomyRank, string> = {
  domain: 'Domain', phylum: 'Phylum', class: 'Class', order: 'Order',
  family: 'Family', genus: 'Genus', species: 'Species',
};

export const RANK_PLURAL: Record<TaxonomyRank, string> = {
  domain: 'domains', phylum: 'phyla', class: 'classes', order: 'orders',
  family: 'families', genus: 'genera', species: 'species',
};

// A true zero gets a dash; a small real share keeps a non-zero figure so "none" and "few" stay distinct.
export const pct = (share: number) => {
  if (share <= 0) return '0%';
  if (share < 0.001) return '<0.1%';
  return `${(share * 100).toFixed(share >= 0.1 ? 0 : 1)}%`;
};

/** OKLCH hue angle (degrees) and chroma of an sRGB hex colour. */
const oklchOf = (hex: string): { c: number; h: number } => {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = lin((n >> 16) & 255);
  const g = lin((n >> 8) & 255);
  const b = lin(n & 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { c: Math.hypot(a, bb), h: ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360 };
};

/**
 * The darkest cell colour for a class: its own hue at one lightness and a capped
 * chroma, so a share reads equally dark in any column. The raw palette's pinks and
 * yellows are far lighter than its blues.
 */
const RAMP_L = 0.58;
const RAMP_C = 0.13;
const rampEnd = (hex: string): string => {
  const { c, h } = oklchOf(hex);
  // A near-grey class ("other") keeps its low chroma rather than gaining a hue.
  return `oklch(${RAMP_L} ${Math.min(c, RAMP_C).toFixed(3)} ${h.toFixed(1)})`;
};

/** A class column is hidden while it is under this share in every row shown; the note under the header names what is hidden. */
const HIDE_BELOW = 0.01;

interface HoverState { row: CompositionRow; category: string; x: number; y: number }

export interface TaxonomyCompositionViewProps {
  /** Rank the DATA is at — never the pending selection. */
  shownRank: TaxonomyRank;
  rows: CompositionRow[];
  categories: readonly string[];
  maxShare: number;
  entityNoun: { one: string; many: string };
  coverage: ReactNode;
  controls: ReactNode;
  refreshing?: boolean;
}

export function TaxonomyCompositionView({
  shownRank, rows, categories, maxShare, entityNoun, coverage, controls, refreshing = false,
}: TaxonomyCompositionViewProps) {
  const [hover, setHover] = useState<HoverState | null>(null);
  const faint = categories.filter((category) => rows.every((row) => (row.shares[category] ?? 0) < HIDE_BELOW));
  const shownCategories = categories.filter((category) => !faint.includes(category));

  // The same right-edge fade ResizableTable uses: on a phone the class columns
  // run off the card with nothing to say they continue.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const measureScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el) setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
  }, []);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    measureScroll();
    const observer = new ResizeObserver(measureScroll);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measureScroll, shownCategories.length, rows.length]);

  return (
    // Full width when it is the only chart in its grid. Beside the stacked bar charts
    // it is stretched to their height, and the table rows share out the extra.
    <Card className="lg:only:col-span-2">
      <CardHeader className="flex flex-col items-start gap-2 space-y-0 sm:flex-row sm:items-center sm:justify-between">
        {/* No help icon here: CardHeader is a @container, so a Radix popper inside it renders off the top of the page. */}
        <CardTitle className="min-w-0 sm:whitespace-nowrap">Taxonomic composition</CardTitle>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          {/* Previous data stays on screen across a rank change, so show that a refetch is in flight. */}
          <Loader2
            aria-hidden={!refreshing}
            className={`size-3.5 shrink-0 animate-spin text-muted-foreground transition-opacity ${
              refreshing ? 'opacity-100' : 'opacity-0'
            }`}
          />
          {controls}
        </div>
      </CardHeader>

      <div className="-mt-2 px-6 pb-3 text-xs text-muted-foreground">
        {coverage}
        {faint.length > 0 && <div>{faint.join(', ')} hidden: under 1% in every row.</div>}
      </div>

      <CardContent className="flex flex-1 flex-col">
        {/* Scrolls inside its own container with the taxon pinned, so the page never scrolls sideways at 390px. */}
        <div className="relative flex-1">
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-0 right-0 z-20 w-14 bg-gradient-to-l from-card via-card/80 to-transparent transition-opacity duration-200 ${
            canScrollRight ? 'opacity-100' : 'opacity-0'
          }`}
        />
        <div
          ref={scrollRef}
          onScroll={measureScroll}
          className={`h-full overflow-x-auto transition-opacity ${refreshing ? 'opacity-40' : 'opacity-100'}`}
          aria-busy={refreshing}
        >
          <table className="h-full w-full min-w-[620px] table-fixed border-separate border-spacing-0 text-[13px]">
            <caption className="sr-only">
              Share of each taxon&apos;s {entityNoun.many} carrying each category, at {shownRank} rank.
            </caption>
            {/* table-fixed + colgroup so the class columns are even rather than content-sized. */}
            <colgroup>
              <col className="w-[190px]" />
              {shownCategories.map((category) => <col key={category} />)}
              <col className="w-[104px]" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 z-10 bg-card px-2 py-1.5 text-left font-medium text-muted-foreground">
                  {RANK_LABEL[shownRank]}
                </th>
                {shownCategories.map((category) => (
                  <th key={category} scope="col" className="px-1 py-1.5 text-center font-medium text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <span
                        aria-hidden
                        className="size-2 shrink-0 rounded-[2px]"
                        style={{ backgroundColor: getProductCategoryColor(category) }}
                      />
                      {category}
                    </span>
                  </th>
                ))}
                <th scope="col" className="px-2 py-1.5 text-right font-medium text-muted-foreground">
                  {entityNoun.many}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.kind}-${row.key || index}`}>
                  <th
                    scope="row"
                    className={`sticky left-0 z-10 truncate bg-card px-2 py-1 text-left font-normal ${
                      row.kind === 'taxon' ? 'text-foreground' : 'italic text-muted-foreground'
                    }`}
                    title={row.label}
                  >
                    {row.label}
                  </th>
                  {shownCategories.map((category) => {
                    const share = row.shares[category];
                    const hue = rampEnd(getProductCategoryColor(category));
                    // One shared 0->max ramp across every column, toward ramp
                    // ends of equal lightness, so a share reads equally dark in
                    // any column — the reason the scale is not per-column.
                    const mix = maxShare > 0 ? share / maxShare : 0;
                    return (
                      <td
                        key={category}
                        className="px-1 py-1 text-center font-mono tabular-nums"
                        style={{
                          backgroundColor: `color-mix(in oklab, ${hue} ${(mix * 100).toFixed(1)}%, var(--card))`,
                          // The darkest cell is L 0.58: the theme's foreground
                          // reads at ~5.5:1 there in light mode, white at ~3.3:1,
                          // and in dark mode the foreground is the light one.
                          color: 'var(--foreground)',
                        }}
                        onMouseEnter={(e) => setHover({ row, category, x: e.clientX, y: e.clientY })}
                        onMouseMove={(e) => setHover({ row, category, x: e.clientX, y: e.clientY })}
                        onMouseLeave={() => setHover(null)}
                      >
                        {share > 0 ? pct(share) : <span className="text-muted-foreground/40">–</span>}
                      </td>
                    );
                  })}
                  <td className="px-2 py-1 text-right font-mono tabular-nums text-muted-foreground">
                    {row.count.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>
      </CardContent>

      {/* fixed positioning => clientX/clientY, never pageX/pageY. */}
      {hover && (
        <div className={TOOLTIP_CLASSES} style={{ left: hover.x + 12, top: hover.y + 12 }}>
          <div className="font-medium">{hover.row.label}</div>
          <div className="text-muted-foreground">
            {pct(hover.row.shares[hover.category])} of its {hover.row.count.toLocaleString()}
            {' '}{hover.row.count === 1 ? entityNoun.one : entityNoun.many} carry {hover.category}
          </div>
          <div className="font-mono tabular-nums text-muted-foreground">
            {hover.row.counts[hover.category].toLocaleString()} {entityNoun.many}
          </div>
        </div>
      )}
    </Card>
  );
}

export function TaxonomyCompositionPlaceholder({
  controls, failed,
}: { controls: ReactNode; failed?: boolean }) {
  return (
    <Card className="lg:only:col-span-2">
      <CardHeader className="flex flex-col items-start gap-2 space-y-0 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="min-w-0 sm:whitespace-nowrap">Taxonomic composition</CardTitle>
        <div className="flex w-full items-center gap-2 sm:w-auto">{controls}</div>
      </CardHeader>
      <CardContent>
        {failed
          ? <p className="py-8 text-center text-sm text-muted-foreground">Failed to load taxonomic composition.</p>
          : <ChartSkeleton height={380} />}
      </CardContent>
    </Card>
  );
}
