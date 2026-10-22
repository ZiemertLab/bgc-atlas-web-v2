'use client';

import { useEffect, useRef, useState, memo } from 'react';
import { createPortal } from 'react-dom';
import * as d3 from '@/lib/d3';
import { getContrastingTextColor, getTaxonomyColor, TOOLTIP_CLASSES, useChartDimensions } from '@/lib/utils/chart-utils';
import { getTaxonDisplayName } from '@/lib/utils/taxonomy-utils';

interface TaxonomyDistributionChartProps {
  distribution: Record<string, number>;
  height?: number;
  className?: string;
  // The /gcfs list API sends only each rank's top taxa; this is how many the
  // GCF spans in total, so "Other" can count the taxa that were trimmed away.
  taxaCount?: number;
}

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  content: string;
  taxon: string;
  percentage: number;
}

// Build segments. Taxa holding at least OTHER_MIN_PERCENT of the GCF are
// drawn individually; the long tail (at low ranks a GCF can span thousands of
// taxa, each a tiny share) is collapsed into a single "Other" bucket. Other's
// width fills the bar to 100%, so it also absorbs the small shortfall from
// rounding each taxon's percentage — no blank, unlabelled gap at the right.
const MIN_SEGMENT_PX = 0.5;
const OTHER_MIN_PERCENT = 5; // taxa below this share collapse into "Other"

export type TaxonomySegment = { taxon: string; percentage: number; isOther: boolean; count: number };

export function buildTaxonomySegments(
  distribution: Record<string, number>,
  width: number,
  taxaCount?: number,
): TaxonomySegment[] {
  // Sort by percentage descending for consistent visual order
  const sorted = Object.entries(distribution).sort(([, a], [, b]) => b - a);
  const toPx = (percentage: number) => (percentage / 100) * width;

  const drawnSegments: TaxonomySegment[] = [];
  let drawnSum = 0;
  let undrawnGiven = 0;
  sorted.forEach(([taxon, percentage], index) => {
    // Keep a taxon out of "Other" when it meets the threshold (and is wide
    // enough to render). Always keep the single largest taxon so a very even
    // distribution never collapses into an all-"Other" bar.
    const meetsThreshold = percentage >= OTHER_MIN_PERCENT || index === 0;
    if (meetsThreshold && toPx(percentage) >= MIN_SEGMENT_PX) {
      drawnSegments.push({ taxon, percentage, isOther: false, count: 1 });
      drawnSum += percentage;
    } else {
      undrawnGiven += 1;
    }
  });

  // With taxaCount, the tail may have been trimmed from `distribution`
  // entirely while still existing, so count Other from the full total. The max
  // never reports fewer than the entries held, should taxaCount be stale.
  const otherCount = taxaCount !== undefined
    ? Math.max(undrawnGiven, taxaCount - drawnSegments.length)
    : undrawnGiven;

  const segments: TaxonomySegment[] = [...drawnSegments];
  const otherPercentage = Math.max(0, 100 - drawnSum);
  if (otherCount > 0 && toPx(otherPercentage) >= MIN_SEGMENT_PX) {
    segments.push({ taxon: '__other__', percentage: otherPercentage, isOther: true, count: otherCount });
  }
  return segments;
}

function TaxonomyDistributionChartComponent({
  distribution,
  height = 24,
  className = '',
  taxaCount,
}: TaxonomyDistributionChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { width } = useChartDimensions(containerRef);
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    content: '',
    taxon: '',
    percentage: 0,
  });

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;

    if (Object.keys(distribution).length === 0) return;

    const currentWidth = Math.max(width || containerRef.current.getBoundingClientRect().width, 100);

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const getColor = (taxon: string, index: number) => getTaxonomyColor(taxon, index);

    const xScale = d3.scaleLinear()
      .domain([0, 100])
      .range([0, currentWidth]);

    const OTHER_COLOR = '#cbd5e1'; // slate-300: neutral, distinct from the Unknown gray
    const segments = buildTaxonomySegments(distribution, currentWidth, taxaCount);

    let cumulativeX = 0;

    segments.forEach((seg, i) => {
      const barWidth = xScale(seg.percentage);

      const fill = seg.isOther ? OTHER_COLOR : getColor(seg.taxon, i);
      const displayName = seg.isOther ? 'Other' : getTaxonDisplayName(seg.taxon);
      const tooltipTaxon = seg.isOther ? `Other (${seg.count.toLocaleString()} taxa)` : displayName;

      const rect = svg.append('rect')
        .attr('x', cumulativeX)
        .attr('y', 0)
        .attr('width', barWidth)
        .attr('height', height)
        .attr('fill', fill)
        .attr('cursor', 'default')
        .style('transition', 'opacity 0.2s');

      rect.on('mouseenter', function(event) {
        d3.select(this).style('opacity', '0.8');

        const r = (event.currentTarget as SVGRectElement).getBoundingClientRect();
        setTooltip({
          visible: true,
          x: r.left + r.width / 2,
          y: r.top - 10,
          content: `${tooltipTaxon}: ${seg.percentage.toFixed(1)}%`,
          taxon: tooltipTaxon,
          percentage: seg.percentage,
        });
      });

      rect.on('mouseleave', function() {
        d3.select(this).style('opacity', '1');
        setTooltip(prev => ({ ...prev, visible: false }));
      });

      const label = svg.append('text')
        .attr('x', cumulativeX + barWidth / 2)
        .attr('y', height / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'middle')
        .attr('font-size', '10px')
        .attr('font-weight', 500)
        .attr('fill', getContrastingTextColor(fill))
        .attr('pointer-events', 'none')
        .style('user-select', 'none')
        .text(displayName);
      const labelWidth = (label.node() as SVGTextElement | null)?.getComputedTextLength() ?? Infinity;
      if (labelWidth > barWidth - 6) {
        label.remove();
      }

      cumulativeX += barWidth;
    });

  }, [distribution, height, width, taxaCount]);

  if (!distribution || Object.keys(distribution).length === 0) {
    return <span className="text-muted-foreground text-xs">No data</span>;
  }

  return (
    <>
      <div ref={containerRef} className={`w-full ${className}`}>
        <svg
          ref={svgRef}
          width="100%"
          height={height}
          style={{ display: 'block' }}
          aria-label={`Taxonomy distribution: ${Object.entries(distribution)
            .map(([taxon, pct]) => `${getTaxonDisplayName(taxon)} ${pct.toFixed(1)}%`)
            .join(', ')}`}
        />
      </div>
      {tooltip.visible && typeof document !== 'undefined' && createPortal(
        <div
          className={TOOLTIP_CLASSES}
          style={{
            left: `${tooltip.x}px`,
            top: `${tooltip.y}px`,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <div className="font-medium">{tooltip.taxon}</div>
          <div className="text-xs">{tooltip.percentage.toFixed(1)}%</div>
        </div>,
        document.body
      )}
    </>
  );
}

export const TaxonomyDistributionChart = memo(
  TaxonomyDistributionChartComponent,
  (prevProps, nextProps) => {
    return (
      JSON.stringify(prevProps.distribution) === JSON.stringify(nextProps.distribution) &&
      prevProps.height === nextProps.height &&
      prevProps.taxaCount === nextProps.taxaCount
    );
  }
);

TaxonomyDistributionChart.displayName = 'TaxonomyDistributionChart';
