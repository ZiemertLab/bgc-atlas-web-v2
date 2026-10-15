'use client';

import { useEffect, useRef, useState, memo } from 'react';
import { createPortal } from 'react-dom';
import * as d3 from '@/lib/d3';
import { getContrastingTextColor, getEcosystemColor, TOOLTIP_CLASSES, useChartDimensions } from '@/lib/utils/chart-utils';

interface BiomeDistributionChartProps {
  distribution: Record<string, number>;
  height?: number;
  className?: string;
  /** Segment colour. Defaults to the GOLD ecosystem palette; any other
   *  share-of-100 distribution passes its own (e.g. getSourceTypeColor). */
  getColor?: (key: string, index: number) => string;
  /** Segment name for the in-bar label and tooltip; defaults to the key. */
  formatLabel?: (key: string) => string;
  /** What the distribution is, for the aria-label. */
  ariaLabel?: string;
}

// Module-level so the default keeps one identity: the draw effect depends on
// it, and an inline default would redraw (and drop hover state) every render.
const identity = (key: string) => key;

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  content: string;
  biome: string;
  percentage: number;
}

function BiomeDistributionChartComponent({
  distribution,
  height = 24,
  className = '',
  getColor = getEcosystemColor,
  formatLabel = identity,
  ariaLabel = 'GOLD ecosystem distribution',
}: BiomeDistributionChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { width } = useChartDimensions(containerRef);
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    content: '',
    biome: '',
    percentage: 0,
  });

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;

    const entries = Object.entries(distribution);

    if (entries.length === 0) return;

    const sorted = entries.sort(([, a], [, b]) => b - a);

    const currentWidth = Math.max(width || containerRef.current.getBoundingClientRect().width, 100);

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const xScale = d3.scaleLinear()
      .domain([0, 100])
      .range([0, currentWidth]);

    // Create bars with cumulative positioning. Segments of one branch share a
    // colour, so a thin gap keeps adjacent same-coloured segments apart.
    const GAP = 1;
    let cumulativeX = 0;

    sorted.forEach(([biome, percentage], i) => {
      const barWidth = xScale(percentage);

      if (barWidth < 0.5) return;

      const isLast = i === sorted.length - 1;
      const rect = svg.append('rect')
        .attr('x', cumulativeX)
        .attr('y', 0)
        .attr('width', isLast ? barWidth : Math.max(barWidth - GAP, 0.5))
        .attr('height', height)
        .attr('fill', getColor(biome, i))
        .attr('cursor', 'default')
        .style('transition', 'opacity 0.2s');

      rect.on('mouseenter', function(event) {
        d3.select(this).style('opacity', '0.8');

        const rect = (event.currentTarget as SVGRectElement).getBoundingClientRect();
        setTooltip({
          visible: true,
          x: rect.left + rect.width / 2,
          y: rect.top - 10,
          content: `${formatLabel(biome)}: ${percentage.toFixed(1)}%`,
          biome: formatLabel(biome),
          percentage,
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
        .attr('fill', getContrastingTextColor(getColor(biome, i)))
        .attr('pointer-events', 'none')
        .style('user-select', 'none')
        .text(formatLabel(biome));
      const labelWidth = (label.node() as SVGTextElement | null)?.getComputedTextLength() ?? Infinity;
      if (labelWidth > barWidth - 6) {
        label.remove();
      }

      cumulativeX += barWidth;
    });

  }, [distribution, height, width, getColor, formatLabel]);

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
          aria-label={`${ariaLabel}: ${Object.entries(distribution)
            .map(([key, pct]) => `${formatLabel(key)} ${pct.toFixed(1)}%`)
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
          <div className="font-medium">{tooltip.biome}</div>
          <div className="text-xs">{tooltip.percentage.toFixed(1)}%</div>
        </div>,
        document.body
      )}
    </>
  );
}

export const BiomeDistributionChart = memo(
  BiomeDistributionChartComponent,
  (prevProps, nextProps) => {
    return (
      JSON.stringify(prevProps.distribution) === JSON.stringify(nextProps.distribution) &&
      prevProps.height === nextProps.height &&
      prevProps.getColor === nextProps.getColor &&
      prevProps.formatLabel === nextProps.formatLabel
    );
  }
);

BiomeDistributionChart.displayName = 'BiomeDistributionChart';
