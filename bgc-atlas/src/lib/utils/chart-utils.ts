'use client';

import { useEffect, useState } from 'react';
import { format, scaleLinear } from '@/lib/d3';
import { ECOSYSTEM_PALETTE, toEcosystemKey } from './ecosystem-palette';
import { GOLD_LEAF_BRANCH, type GoldBranch } from './gold-leaf-branches.generated';
import { getGoldSubtreeColorHex, GOLD_PLANTS_COLOR_HEX, GOLD_AQUATIC_COLOR_HEX } from './gold-parser';
import { stableTaxonColor, taxonomyColorFor } from './taxonomy-palette';

// Okabe-Ito palette; the same hues as the --chart-1..8 tokens in globals.css, reordered.
export const OKABE_ITO = [
  '#0072B2', // blue (lead)
  '#D55E00', // vermillion
  '#009E73', // bluish green
  '#E69F00', // orange
  '#CC79A7', // reddish purple
  '#56B4E9', // sky blue
  '#F0E442', // yellow
  '#000000', // near-black
] as const;

export const CHART_COLORS = {
  primary: OKABE_ITO[0],
  success: OKABE_ITO[2],
  warning: OKABE_ITO[3],
  purple: OKABE_ITO[4],
  pink: OKABE_ITO[1],
  indigo: OKABE_ITO[5],
  scale: [...OKABE_ITO] as readonly string[],
} as const;

export function getContrastingTextColor(background: string): string {
  let hex = background.trim().replace('#', '');
  if (hex.length === 3) {
    hex = hex.split('').map((c) => c + c).join('');
  }
  if (hex.length !== 6) return '#ffffff';
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#1a1a1a' : '#ffffff';
}

export const CHART_MARGINS = {
  default: { top: 20, right: 40, bottom: 40, left: 60 },
  withLeftLabels: { top: 20, right: 40, bottom: 40, left: 120 },
  withBottomLabels: { top: 20, right: 40, bottom: 60, left: 60 },
  compact: { top: 10, right: 20, bottom: 30, left: 40 },
} as const;

export const CHART_STYLES = {
  fontSize: {
    axis: 11,
    label: 12,
    title: 14,
  },
  strokeWidth: 1,
  transitionDuration: 300,
} as const;

/**
 * GOLD ecosystem colours. A segment at any level takes its branch's colour —
 * the top-level ecosystem, or the Host-associated:Plants (green) or
 * Environmental:Aquatic (blue) subtree — so a level-3 bar reads the same way as
 * the level-1 legend, the badges and the sunburst.
 */
export const ECOSYSTEM_COLORS: Record<string, string> = {
  // Sourced from the shared ECOSYSTEM_PALETTE so they can't drift.
  'Environmental': ECOSYSTEM_PALETTE.environmental.hex,
  'Host-associated': ECOSYSTEM_PALETTE['host-associated'].hex,
  'Engineered': ECOSYSTEM_PALETTE.engineered.hex,
  'Mixed': ECOSYSTEM_PALETTE.mixed.hex,
  // Synthetic level-1 bucket; EcosystemLegend keys its level-1 row off this map.
  'Host-assoc.: Plants': GOLD_PLANTS_COLOR_HEX,
  'Unknown': ECOSYSTEM_PALETTE.unknown.hex,
} as const;

const BRANCH_COLOR: Record<GoldBranch, string> = {
  environmental: ECOSYSTEM_PALETTE.environmental.hex,
  'host-associated': ECOSYSTEM_PALETTE['host-associated'].hex,
  engineered: ECOSYSTEM_PALETTE.engineered.hex,
  mixed: ECOSYSTEM_PALETTE.mixed.hex,
  plants: GOLD_PLANTS_COLOR_HEX,
  aquatic: GOLD_AQUATIC_COLOR_HEX,
};

const NORMALIZED_ECOSYSTEM_COLOR_MAP = Object.entries(ECOSYSTEM_COLORS).reduce<Record<string, string>>((acc, [key, color]) => {
  acc[key.toLowerCase()] = color;
  return acc;
}, {});

/**
 * Colour for a GOLD ecosystem: a full path ("Host-associated:Plants:Roots"), a
 * top-level name, or a bare level-2+ leaf ("Roots") as the GCF browse index
 * stores them. Leaves resolve through GOLD_LEAF_BRANCH; one split between
 * branches, or not in the table, is unknown grey rather than a guess.
 */
export function getEcosystemColor(ecosystem: string, _fallbackIndex: number = 0): string {
  const subtree = getGoldSubtreeColorHex(ecosystem);
  if (subtree) return subtree;
  const cleaned = ecosystem?.trim() ?? '';
  if (!cleaned) return ECOSYSTEM_PALETTE.unknown.hex;

  const lower = cleaned.toLowerCase();
  if (lower in NORMALIZED_ECOSYSTEM_COLOR_MAP) return NORMALIZED_ECOSYSTEM_COLOR_MAP[lower];

  // A path: colour by its top level.
  if (cleaned.includes(':')) {
    return ECOSYSTEM_PALETTE[toEcosystemKey(cleaned.split(':')[0].trim())].hex;
  }

  const branch = GOLD_LEAF_BRANCH[lower];
  return branch ? BRANCH_COLOR[branch] : ECOSYSTEM_PALETTE.unknown.hex;
}

export const PRODUCT_CATEGORY_COLORS: Record<string, string> = {
  'terpene': '#CC79A7',
  'Terpene': '#CC79A7',
  'RiPP': '#009E73',
  'NRPS': '#0072B2',
  'PKS': '#D55E00',
  'Polyketide': '#D55E00',
  'Hybrid': '#56B4E9',
  'saccharide': '#E69F00',
  'Saccharide': '#E69F00',
  'Alkaloid': '#F0E442',
  'Other': '#6b7280',
  'other': '#6b7280',
} as const;

/**
 * Assembly source_type colours: the property-search map's sample-type palette,
 * shared so a dataset type reads the same on the map and in /studies.
 */
export const SOURCE_TYPE_COLORS: Record<string, string> = {
  metagenome: '#0072b2',
  isolate: '#d55e00',
  MAG: '#009e73',
  SAG: '#785ef0',
};

/** Display order and labels; the keys are assemblies.source_type values. */
export const SOURCE_TYPE_LABELS: Record<string, string> = {
  metagenome: 'Metagenome',
  MAG: 'MAG',
  SAG: 'SAG',
  isolate: 'Isolate',
};

export function getSourceTypeColor(sourceType: string, fallbackIndex: number = 0): string {
  return SOURCE_TYPE_COLORS[sourceType] ?? CHART_COLORS.scale[fallbackIndex % CHART_COLORS.scale.length];
}

export function getProductCategoryColor(category: string, fallbackIndex: number = 0): string {
  const lower = category.toLowerCase();

  const key = Object.keys(PRODUCT_CATEGORY_COLORS).find(k => k.toLowerCase() === lower);
  if (key) {
    return PRODUCT_CATEGORY_COLORS[key as keyof typeof PRODUCT_CATEGORY_COLORS];
  }

  return CHART_COLORS.scale[fallbackIndex % CHART_COLORS.scale.length];
}

export function getProductCategoryBadgeStyle(category: string): React.CSSProperties {
  const bgColor = getProductCategoryColor(category);

  const darkCategories = [
    'terpene', 'RiPP', 'NRPS', 'Alkaloid', 'Other'
  ];

  const isDark = darkCategories.some(c => category.toLowerCase() === c.toLowerCase());

  return {
    backgroundColor: bgColor,
    color: isDark ? '#ffffff' : '#000000',
    borderColor: 'transparent'
  };
}

export const TOOLTIP_CLASSES = 'pointer-events-none fixed z-50 rounded-sm border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-[0_4px_16px_-8px_rgba(0,0,0,0.15)]';

function debounce<TArgs extends unknown[], TReturn>(
  func: (...args: TArgs) => TReturn,
  wait: number
): (...args: TArgs) => void {
  let timeout: NodeJS.Timeout;
  return (...args: TArgs) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

export function useChartDimensions(containerRef: React.RefObject<HTMLDivElement | null>) {
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const updateDimensions = debounce(() => {
      if (containerRef.current) {
        const { width, height } = containerRef.current.getBoundingClientRect();
        // Bail out on unchanged dimensions to avoid a render loop.
        setDimensions(prev => {
          if (prev.width === width && prev.height === height) {
            return prev;
          }
          return { width, height };
        });
      }
    }, 100);

    const resizeObserver = new ResizeObserver(updateDimensions);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
      updateDimensions();
    }

    return () => resizeObserver.disconnect();
  }, [containerRef]);

  return dimensions;
}

export function getResponsiveFontSize(width: number, baseSize: number = 11): number {
  if (width < 400) return Math.max(9, baseSize - 2);
  if (width < 600) return Math.max(10, baseSize - 1);
  return baseSize;
}

export function getResponsiveMargins(width: number, baseMargins: { top: number; right: number; bottom: number; left: number }) {
  if (width < 400) {
    return {
      top: Math.max(10, baseMargins.top * 0.5),
      right: Math.max(20, baseMargins.right * 0.5),
      bottom: Math.max(30, baseMargins.bottom * 0.75),
      left: Math.max(40, baseMargins.left * 0.67),
    };
  }
  return baseMargins;
}

/**
 * Tick format for a count axis: always the compact form ("6M", "150k"), so the same
 * axis reads the same at every width. Exact counts belong in the value labels and
 * tooltips. `_width` stays in the signature for existing callers.
 */
export function countTickFormat(_width?: number): (n: number) => string {
  const compact = format('~s');
  return (n) => compact(n);
}

/**
 * A count printed beside a bar: exact below 10,000 (where "3,683" is short
 * enough and rounding would hide a small category), compact above it
 * ("196k", "4.7M"). The exact figure goes in the bar's tooltip.
 */
export function formatCompactCount(n: number): string {
  const abs = Math.abs(n);
  if (abs < 10_000) return Math.round(n).toLocaleString();
  if (abs < 1_000_000) return `${(n / 1_000).toFixed(abs < 100_000 ? 1 : 0)}k`;
  if (abs < 1_000_000_000) return `${(n / 1_000_000).toFixed(abs < 100_000_000 ? 1 : 0)}M`;
  return `${(n / 1_000_000_000).toFixed(1)}B`;
}

/** The labels d3.axisLeft draws for a linear [0, max] count axis after .nice(). */
export function countAxisLabels(max: number, ticks: number, tickFormat: (n: number) => string): string[] {
  return scaleLinear().domain([0, max]).nice().ticks(ticks).map(tickFormat);
}

/**
 * `labels` must be what the axis will draw (see countAxisLabels). `titleY` is the
 * baseline of a rotate(-90) title, with the glyphs left of it.
 */
export function fitYAxisMargin(
  svg: SVGSVGElement,
  opts: {
    labels: string[];
    fontSize: number;
    min: number;
    titleFontSize?: number;
  },
): { left: number; titleY: number } {
  const probe = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  // Must match the attribute d3-axis sets; globals.css restyles both to the same font.
  probe.setAttribute('font-family', 'sans-serif');
  probe.setAttribute('font-size', `${opts.fontSize}px`);
  svg.appendChild(probe);
  let widest = 0;
  for (const label of opts.labels) {
    probe.textContent = label;
    widest = Math.max(widest, probe.getComputedTextLength());
  }
  probe.remove();
  // d3-axis: 6px tick + 3px padding before the label.
  const axisWidth = Math.ceil(widest) + 9;
  const titleY = -(axisWidth + 6);
  const needed = opts.titleFontSize ? -titleY + opts.titleFontSize + 4 : axisWidth + 4;
  return { left: Math.max(opts.min, needed), titleY };
}

// For x-axis labels drawn at rotate(-45).
export function fitRotatedXAxisMargin(
  svg: SVGSVGElement,
  opts: { labels: string[]; fontSize: number; min: number; max: number },
): number {
  const probe = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  probe.setAttribute('font-family', 'sans-serif');
  probe.setAttribute('font-size', `${opts.fontSize}px`);
  svg.appendChild(probe);
  let widest = 0;
  for (const label of opts.labels) {
    probe.textContent = label;
    widest = Math.max(widest, probe.getComputedTextLength());
  }
  probe.remove();
  // A 45° label drops (width + line height) / √2; then 6px tick, 3px padding, 6px air.
  const needed = Math.ceil((widest + opts.fontSize) * Math.SQRT1_2) + 9 + 6;
  return Math.min(opts.max, Math.max(opts.min, needed));
}

// `_fallbackIndex` is unused; kept so `colorOf(d, i)` callers still typecheck.
export function getTaxonomyColor(taxon: string | null | undefined, _fallbackIndex: number = 0): string {
  return stableTaxonColor(taxon);
}

// Undefined when the row has no phylum and no domain, so the cell falls back to an outline badge.
export function getTaxonomyBadgeStyle(
  rank: string,
  phylum: string | null | undefined,
  domain: string | null | undefined,
): React.CSSProperties | undefined {
  const color = taxonomyColorFor(rank, phylum, domain);
  if (!color) return undefined;

  return {
    backgroundColor: color,
    color: getContrastingTextColor(color),
    borderColor: 'transparent',
  };
}
