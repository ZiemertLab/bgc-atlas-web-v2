'use client';

import { useRef, useEffect, useMemo } from 'react';
import * as d3 from '@/lib/d3';
import { useTaxonomyDistribution } from '@/lib/hooks/use-taxonomy-distribution';
import { TaxonomyRank, type TaxonomyDistributionData } from '@/lib/types';
import { getTaxonomyColor } from '@/lib/utils/chart-utils';
import { Sunburst, type SunburstRow } from './sunburst.client';
import { ChartViewToggle, type ChartView } from './gcf-detail-charts.client';
import { aggregateByRank, truncateTaxonName } from '@/lib/utils/taxonomy-utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';

interface TaxonomyDistributionChartProps {
  gcfId: string;
  className?: string;
  defaultWidth?: number;
  defaultHeight?: number;
}

export function TaxonomyDistributionChart({
  gcfId,
  className = '',
  defaultWidth = 800,
  defaultHeight = 500,
}: TaxonomyDistributionChartProps) {
  const { data, isLoading, error } = useTaxonomyDistribution(gcfId);
  const [selectedRank, setSelectedRank] = useState<TaxonomyRank>('phylum');
  const [view, setView] = useState<ChartView>('sunburst');
  const [dimensions, setDimensions] = useState({ width: defaultWidth, height: defaultHeight });
  const containerRef = useRef<HTMLDivElement>(null);
  const sunburstRef = useRef<HTMLDivElement>(null);

  // Full-lineage rows: walk ranks until the first gap.
  const sunburstRows = useMemo<SunburstRow[]>(() => {
    const ranks: (keyof TaxonomyDistributionData)[] = ['domain', 'phylum', 'class', 'order', 'family', 'genus', 'species'];
    return (data?.distribution ?? []).map((row) => {
      const segments: string[] = [];
      for (const r of ranks) {
        const raw = row[r] as string | null;
        const clean = raw ? String(raw).replace(/^[dpcofgs]__/, '').trim() : '';
        if (!clean) break;
        segments.push(clean);
      }
      return { segments, value: row.bgcCount };
    }).filter((r) => r.segments.length > 0);
  }, [data]);

  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        setDimensions({
          width: width || defaultWidth,
          height: defaultHeight,
        });
      }
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [defaultWidth, defaultHeight]);

  const aggregatedData = useMemo(() => {
    if (!data?.distribution) return [];
    return aggregateByRank(data.distribution, selectedRank).slice(0, 15);
  }, [data, selectedRank]);

  if (isLoading) {
    return (
      <div className={`flex h-[500px] items-center justify-center border border-border bg-card text-sm text-muted-foreground ${className}`}>
        Loading taxonomy…
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Failed to load taxonomy data: {error.message}
        </AlertDescription>
      </Alert>
    );
  }

  if (!data || (aggregatedData.length === 0 && sunburstRows.length === 0)) {
    return (
      <Alert>
        <AlertDescription>
          No taxonomy data available for this GCF. Taxonomy information may not have been imported
          yet.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div ref={containerRef} className={`space-y-4 ${className}`}>
      <div className="flex flex-wrap justify-between items-center gap-2">
        {view === 'bars' ? (
          <div className="flex items-center gap-2">
            <label htmlFor="taxonomy-rank-select" className="text-sm font-medium">
              Taxonomy Rank:
            </label>
            <Select value={selectedRank} onValueChange={(value) => setSelectedRank(value as TaxonomyRank)}>
              <SelectTrigger id="taxonomy-rank-select" className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="domain">Domain</SelectItem>
                <SelectItem value="phylum">Phylum</SelectItem>
                <SelectItem value="class">Class</SelectItem>
                <SelectItem value="order">Order</SelectItem>
                <SelectItem value="family">Family</SelectItem>
                <SelectItem value="genus">Genus</SelectItem>
                <SelectItem value="species">Species</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground">
              Showing top {Math.min(15, aggregatedData.length)} taxa
            </span>
          </div>
        ) : (
          <span />
        )}
        <ChartViewToggle view={view} onChange={setView} />
      </div>

      {view === 'sunburst' ? (
        <Sunburst
          rows={sunburstRows}
          colorOf={getTaxonomyColor}
          colorDepth={2}
          valueLabel="BGCs"
          rootLabel="All taxa"
          containerRef={sunburstRef}
        />
      ) : (
        <TaxonomyBarChart
          data={aggregatedData}
          width={dimensions.width}
          height={dimensions.height}
        />
      )}
    </div>
  );
}

interface TaxonomyBarChartProps {
  data: { label: string; count: number; percentage: number }[];
  width: number;
  height: number;
}

function TaxonomyBarChart({ data, width, height }: TaxonomyBarChartProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!svgRef.current || !tooltipRef.current || !data.length) return;

    const svg = d3.select<SVGSVGElement, unknown>(svgRef.current);
    const tooltip = d3.select<HTMLDivElement, unknown>(tooltipRef.current);
    svg.selectAll('*').remove();

    const margin = { top: 20, right: 80, bottom: 60, left: 180 };
    const innerWidth = Math.max(0, width - margin.left - margin.right);
    const innerHeight = Math.max(0, height - margin.top - margin.bottom);

    const labelMap = new Map<string, string>();
    data.forEach((item) => {
      const truncated = truncateTaxonName(item.label, 25);
      labelMap.set(truncated, item.label);
    });

    const xScale = d3
      .scaleLinear()
      .domain([0, d3.max(data, (d) => d.count) ?? 0])
      .nice()
      .range([0, innerWidth]);

    const yScale = d3
      .scaleBand()
      .domain(data.map((d) => truncateTaxonName(d.label, 25)))
      .range([0, innerHeight])
      .padding(0.2);

    const root = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    root
      .selectAll('rect')
      .data(data)
      .join('rect')
      .attr('x', 0)
      .attr('y', (d) => yScale(truncateTaxonName(d.label, 25)) ?? 0)
      .attr('width', (d) => xScale(d.count))
      .attr('height', yScale.bandwidth())
      .attr('fill', (d) => getTaxonomyColor(d.label))
      .attr('rx', 3)
      .style('cursor', 'pointer')
      .on('mouseenter', function (event, d) {
        d3.select(this).attr('opacity', 0.7);
        tooltip
          .style('opacity', 1)
          .style('left', `${event.clientX + 10}px`)
          .style('top', `${event.clientY - 10}px`)
          .html(`
            <div class="text-sm">
              <div class="font-semibold">${d.label}</div>
              <div class="text-muted-foreground mt-1">
                BGCs: ${d.count.toLocaleString()} (${d.percentage.toFixed(1)}%)
              </div>
            </div>
          `);
      })
      .on('mousemove', function (event) {
        tooltip
          .style('left', `${event.clientX + 10}px`)
          .style('top', `${event.clientY - 10}px`);
      })
      .on('mouseleave', function () {
        d3.select(this).attr('opacity', 1);
        tooltip.style('opacity', 0);
      });

    root
      .selectAll('text.value')
      .data(data)
      .join('text')
      .attr('class', 'value')
      .attr('x', (d) => xScale(d.count) + 5)
      .attr('y', (d) => (yScale(truncateTaxonName(d.label, 25)) ?? 0) + yScale.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('font-size', '11px')
      .attr('fill', 'currentColor')
      .text((d) => `${d.count.toLocaleString()} (${d.percentage.toFixed(1)}%)`);

    const yAxis = d3.axisLeft(yScale);
    root
      .append('g')
      .attr('class', 'y-axis')
      .call(yAxis)
      .selectAll('text')
      .style('font-size', '11px')
      .style('cursor', 'help')
      .on('mouseenter', function (event, d) {
        const originalLabel = labelMap.get(d as string) || (d as string);
        if (originalLabel !== (d as string)) {
          tooltip
            .style('opacity', 1)
            .style('left', `${event.clientX + 10}px`)
            .style('top', `${event.clientY - 10}px`)
            .html(`<div class="text-sm">${originalLabel}</div>`);
        }
      })
      .on('mouseleave', function () {
        tooltip.style('opacity', 0);
      });

    const xAxis = d3.axisBottom(xScale).ticks(5);
    root
      .append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(xAxis)
      .selectAll('text')
      .style('font-size', '11px');

    root
      .append('text')
      .attr('class', 'x-label')
      .attr('x', innerWidth / 2)
      .attr('y', innerHeight + 40)
      .attr('text-anchor', 'middle')
      .attr('font-size', '12px')
      .attr('font-weight', '500')
      .attr('fill', 'currentColor')
      .text('Number of BGCs');

  }, [data, width, height]);

  return (
    <>
      <svg ref={svgRef} width={width} height={height} className="overflow-visible" />
      <div
        ref={tooltipRef}
        className="pointer-events-none fixed z-50 rounded-lg bg-popover px-3 py-2 text-popover-foreground shadow-md border opacity-0 transition-opacity"
        style={{ opacity: 0 }}
      />
    </>
  );
}
