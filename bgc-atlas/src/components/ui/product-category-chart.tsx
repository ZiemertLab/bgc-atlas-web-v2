'use client';

import { useEffect, useId, useRef, useState, memo } from 'react';
import { createPortal } from 'react-dom';
import * as d3 from '@/lib/d3';
import { getContrastingTextColor, getProductCategoryColor, TOOLTIP_CLASSES, useChartDimensions } from '@/lib/utils/chart-utils';
import { splitCombination } from '@/lib/gcf/category-share';

interface ProductCategoryChartProps {
  distribution: Record<string, number>;
  height?: number;
  className?: string;
  /** What the percentages are of, shown in the tooltip (e.g. "of members"). */
  valueLabel?: string;
}

/** Width of one colour band in a combination's hatch, before rotation. */
const HATCH_BAND = 4;

const displayName = (key: string): string => {
  const parts = splitCombination(key);
  return parts ? parts.join(' + ') : key;
};

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  content: string;
  category: string;
  percentage: number;
}

function ProductCategoryChartComponent({
  distribution,
  height = 24,
  className = '',
  valueLabel,
}: ProductCategoryChartProps) {
  // Unique pattern ids per chart: `url(#id)` resolves document-wide and a table draws one
  // per row. useId's colons are stripped since they are unsafe inside url().
  const patternPrefix = `pcc${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { width } = useChartDimensions(containerRef);
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    content: '',
    category: '',
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

    const getColor = (category: string, index: number) => getProductCategoryColor(category, index);
    const defs = svg.append('defs');

    // A combination ('NRPS+PKS') is hatched in its categories' colours rather than given its own.
    const fillFor = (key: string, index: number): string => {
      const parts = splitCombination(key);
      if (!parts) return getColor(key, index);
      const id = `${patternPrefix}-${index}`;
      const size = HATCH_BAND * parts.length;
      const pattern = defs.append('pattern')
        .attr('id', id)
        .attr('patternUnits', 'userSpaceOnUse')
        .attr('width', size)
        .attr('height', size)
        .attr('patternTransform', 'rotate(45)');
      parts.forEach((part, k) => {
        pattern.append('rect')
          .attr('x', k * HATCH_BAND)
          .attr('y', 0)
          .attr('width', HATCH_BAND)
          .attr('height', size)
          .attr('fill', getColor(part, index));
      });
      return `url(#${id})`;
    };

    const xScale = d3.scaleLinear()
      .domain([0, 100])
      .range([0, currentWidth]);

    let cumulativeX = 0;

    sorted.forEach(([category, percentage], i) => {
      const barWidth = xScale(percentage);

      if (barWidth < 0.5) return;

      const rect = svg.append('rect')
        .attr('x', cumulativeX)
        .attr('y', 0)
        .attr('width', barWidth)
        .attr('height', height)
        .attr('fill', fillFor(category, i))
        .attr('cursor', 'default')
        .style('transition', 'opacity 0.2s');

      rect.on('mouseenter', function(event) {
        d3.select(this).style('opacity', '0.8');

        const rect = (event.currentTarget as SVGRectElement).getBoundingClientRect();
        setTooltip({
          visible: true,
          x: rect.left + rect.width / 2,
          y: rect.top - 10,
          content: `${displayName(category)}: ${percentage.toFixed(1)}%`,
          category: displayName(category),
          percentage,
        });
      });

      rect.on('mouseleave', function() {
        d3.select(this).style('opacity', '1');
        setTooltip(prev => ({ ...prev, visible: false }));
      });

      // Over a hatch no single text colour contrasts with every band, so a combination's
      // label sits on a solid chip.
      const isCombination = splitCombination(category) !== null;
      const group = svg.append('g').attr('pointer-events', 'none');
      const chip = isCombination
        ? group.append('rect').attr('rx', 2).style('fill', 'var(--background)')
        : null;
      const label = group.append('text')
        .attr('x', cumulativeX + barWidth / 2)
        .attr('y', height / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'middle')
        .attr('font-size', '10px')
        .attr('font-weight', 500)
        .style('user-select', 'none')
        .text(category);
      if (isCombination) label.style('fill', 'var(--foreground)');
      else label.attr('fill', getContrastingTextColor(getColor(category, i)));
      const labelWidth = (label.node() as SVGTextElement | null)?.getComputedTextLength() ?? Infinity;
      const chipPad = 3;
      if (labelWidth > barWidth - 6 - (isCombination ? 2 * chipPad : 0)) {
        group.remove();
      } else if (chip) {
        const chipHeight = Math.min(height - 4, 14);
        chip
          .attr('x', cumulativeX + barWidth / 2 - labelWidth / 2 - chipPad)
          .attr('y', (height - chipHeight) / 2)
          .attr('width', labelWidth + 2 * chipPad)
          .attr('height', chipHeight);
      }

      cumulativeX += barWidth;
    });

  }, [distribution, height, width, patternPrefix]);

  if (!distribution || Object.keys(distribution).length === 0) {
    return <span className="text-muted-foreground text-xs">None</span>;
  }

  return (
    <>
      <div ref={containerRef} className={`w-full ${className}`}>
        <svg
          ref={svgRef}
          width="100%"
          height={height}
          style={{ display: 'block' }}
          aria-label={`Category distribution${valueLabel ? `, ${valueLabel}` : ''}: ${Object.entries(distribution)
            .map(([category, pct]) => `${displayName(category)} ${pct.toFixed(1)}%`)
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
          <div className="font-medium">{tooltip.category}</div>
          <div className="text-xs">
            {tooltip.percentage.toFixed(1)}%{valueLabel ? ` ${valueLabel}` : ''}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

export const ProductCategoryChart = memo(
  ProductCategoryChartComponent,
  (prevProps, nextProps) => {
    return (
      JSON.stringify(prevProps.distribution) === JSON.stringify(nextProps.distribution) &&
      prevProps.height === nextProps.height &&
      prevProps.valueLabel === nextProps.valueLabel
    );
  }
);

ProductCategoryChart.displayName = 'ProductCategoryChart';
