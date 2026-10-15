'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';

import { CHART_COLORS } from '@/lib/utils/chart-utils';
import {
  decimalsForSpan,
  formatEnvValue,
  type EnvFieldSummary,
} from '@/lib/utils/environment-fields';

const HISTOGRAM_HEIGHT = 280;
const STRIP_HEIGHT = 130;
const DEFAULT_WIDTH = 700;

export function GcfEnvironmentChart({ field }: { field: EnvFieldSummary }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);

  const isStrip = !field.bins;
  const height = isStrip ? STRIP_HEIGHT : HISTOGRAM_HEIGHT;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width || DEFAULT_WIDTH);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const axisLabel = useMemo(
    () => (field.unit ? `${field.label} (${field.unit})` : field.label),
    [field.label, field.unit]
  );

  useEffect(() => {
    if (!svgRef.current || !tooltipRef.current) return;

    const svg = d3.select<SVGSVGElement, unknown>(svgRef.current);
    const tooltip = d3.select<HTMLDivElement, unknown>(tooltipRef.current);
    svg.selectAll('*').remove();

    // Right margin fits the last axis label, centred on its tick.
    const margin = { top: 12, right: 26, bottom: 46, left: isStrip ? 20 : 52 };
    const innerWidth = Math.max(0, width - margin.left - margin.right);
    const innerHeight = Math.max(0, height - margin.top - margin.bottom);
    if (innerWidth <= 0) return;

    const root = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const domain: [number, number] = isStrip
      ? [field.min, field.max]
      : [field.bins![0].x0, field.bins![field.bins!.length - 1].x1];
    // A zero span would put the single value at an infinite coordinate.
    const span = domain[1] - domain[0];
    const xScale = d3
      .scaleLinear()
      .domain(span > 0 ? domain : [domain[0] - 0.5, domain[0] + 0.5])
      .range([0, innerWidth]);
    const decimals = decimalsForSpan(span > 0 ? span : Math.abs(domain[0]));

    const showTip = (event: MouseEvent, html: string) => {
      tooltip
        .style('opacity', 1)
        .style('left', `${event.clientX + 12}px`)
        .style('top', `${event.clientY - 12}px`)
        .html(html);
    };
    const moveTip = (event: MouseEvent) => {
      tooltip.style('left', `${event.clientX + 12}px`).style('top', `${event.clientY - 12}px`);
    };
    const hideTip = () => tooltip.style('opacity', 0);

    if (isStrip) {
      // Too few values to bin; plot them individually.
      const y = innerHeight / 2;
      root
        .append('line')
        .attr('x1', 0)
        .attr('x2', innerWidth)
        .attr('y1', y)
        .attr('y2', y)
        .attr('stroke', 'currentColor')
        .attr('stroke-width', 1)
        .attr('class', 'text-border');

      root
        .selectAll('circle')
        .data(field.values ?? [])
        .join('circle')
        .attr('cx', (d) => xScale(d))
        // Deterministic alternating offset so coincident values stay countable.
        .attr('cy', (_, i) => y + (i % 2 === 0 ? -7 : 7))
        .attr('r', 5)
        .attr('fill', CHART_COLORS.primary)
        .attr('fill-opacity', 0.65)
        .style('cursor', 'pointer')
        .on('mouseenter', function (event: MouseEvent, d) {
          d3.select(this).attr('fill-opacity', 1);
          showTip(
            event,
            `<strong>${formatEnvValue(d, decimals)}${field.unit ? ` ${field.unit}` : ''}</strong>`
          );
        })
        .on('mousemove', moveTip)
        .on('mouseleave', function () {
          d3.select(this).attr('fill-opacity', 0.65);
          hideTip();
        });
    } else {
      const bins = field.bins!;
      const yScale = d3
        .scaleLinear()
        .domain([0, d3.max(bins, (b) => b.count) ?? 0])
        .nice()
        .range([innerHeight, 0]);

      root
        .append('g')
        .call(d3.axisLeft(yScale).ticks(5).tickFormat((d) => Number(d).toLocaleString()))
        .selectAll('text')
        .attr('font-size', '10px');

      root
        .selectAll('rect')
        .data(bins)
        .join('rect')
        .attr('x', (d) => xScale(d.x0))
        .attr('y', (d) => yScale(d.count))
        .attr('width', (d) => Math.max(1, xScale(d.x1) - xScale(d.x0) - 1))
        .attr('height', (d) => innerHeight - yScale(d.count))
        .attr('fill', CHART_COLORS.primary)
        .style('cursor', 'pointer')
        .on('mouseenter', function (event: MouseEvent, d) {
          d3.select(this).attr('fill-opacity', 0.75);
          const unit = field.unit ? ` ${field.unit}` : '';
          showTip(
            event,
            `<strong>${formatEnvValue(d.x0, decimals)} – ${formatEnvValue(d.x1, decimals)}${unit}</strong><br/>${d.count.toLocaleString()} sample${d.count === 1 ? '' : 's'}`
          );
        })
        .on('mousemove', moveTip)
        .on('mouseleave', function () {
          d3.select(this).attr('fill-opacity', 1);
          hideTip();
        });

      root
        .append('text')
        .attr('transform', 'rotate(-90)')
        .attr('x', -innerHeight / 2)
        .attr('y', -38)
        .attr('text-anchor', 'middle')
        .attr('font-size', '11px')
        .attr('fill', 'currentColor')
        .attr('class', 'text-muted-foreground')
        .text('Samples');
    }

    root
      .append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(
        d3
          .axisBottom(xScale)
          .ticks(Math.max(3, Math.min(8, Math.floor(innerWidth / 70))))
          .tickFormat((d) => formatEnvValue(Number(d), decimals))
      )
      .selectAll('text')
      .attr('font-size', '10px');

    root
      .append('text')
      .attr('x', innerWidth / 2)
      .attr('y', innerHeight + 40)
      .attr('text-anchor', 'middle')
      .attr('font-size', '11px')
      .attr('fill', 'currentColor')
      .attr('class', 'text-muted-foreground')
      .text(axisLabel);
  }, [field, width, height, isStrip, axisLabel]);

  return (
    <div ref={containerRef} className="w-full">
      <svg ref={svgRef} width={width} height={height} role="img" aria-label={axisLabel} />
      <div
        ref={tooltipRef}
        className="pointer-events-none fixed z-50 rounded-sm border border-border bg-popover px-2.5 py-1.5 text-xs shadow-[0_4px_16px_-8px_rgba(0,0,0,0.15)]"
        style={{ opacity: 0 }}
      />
    </div>
  );
}
