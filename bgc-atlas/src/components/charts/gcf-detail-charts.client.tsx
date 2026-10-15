"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from '@/lib/d3';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getProductCategoryColor, getEcosystemColor } from '@/lib/utils/chart-utils';
import { getGOLDColorHex, getGoldSubtreeColorHex } from '@/lib/utils/gold-parser';
import { Button } from '@/components/ui/button';
import { ChartColumnBig, Sun } from 'lucide-react';
import { Sunburst, type SunburstRow } from './sunburst.client';
import { useGoldEcosystemDistribution } from '@/lib/hooks/use-gold-ecosystem-distribution';

export type ChartView = 'sunburst' | 'bars';

export function ChartViewToggle({ view, onChange }: { view: ChartView; onChange: (v: ChartView) => void }) {
  return (
    <div className="inline-flex rounded-sm border border-input">
      <Button
        variant={view === 'sunburst' ? 'default' : 'ghost'}
        size="sm"
        className="rounded-none border-r border-border"
        onClick={() => onChange('sunburst')}
      >
        <Sun className="size-3.5" />
        Sunburst
      </Button>
      <Button
        variant={view === 'bars' ? 'default' : 'ghost'}
        size="sm"
        className="rounded-none"
        onClick={() => onChange('bars')}
      >
        <ChartColumnBig className="size-3.5" />
        Bars
      </Button>
    </div>
  );
}

interface ProductTypeData {
  productCategory: string;
  productType: string;
  bgcCount: number;
  percentage: number;
}

interface ProductTypeChartProps {
  data: ProductTypeData[];
  width: number;
  height: number;
}

export const ProductTypeChart = ({ data, width, height }: ProductTypeChartProps) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const sunburstRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ChartView>('sunburst');
  const sunburstRows = useMemo<SunburstRow[]>(
    () => data.map((d) => ({ segments: [d.productCategory, d.productType].filter(Boolean) as string[], value: d.bgcCount })),
    [data],
  );

  useEffect(() => {
    if (view !== 'bars' || !svgRef.current || !tooltipRef.current || !data.length) return;

    const svg = d3.select<SVGSVGElement, unknown>(svgRef.current);
    const tooltip = d3.select<HTMLDivElement, unknown>(tooltipRef.current);
    svg.selectAll('*').remove();

    const topData = data.slice(0, 15);

    const margin = { top: 20, right: 60, bottom: 40, left: 150 };
    const innerWidth = Math.max(0, width - margin.left - margin.right);
    const innerHeight = Math.max(0, height - margin.top - margin.bottom);

    const truncateLabel = (label: string, maxLength: number = 30): string => {
      if (label.length <= maxLength) return label;
      return label.substring(0, maxLength - 3) + '...';
    };

    const labelMap = new Map<string, string>();
    topData.forEach((item) => {
      const original = `${item.productCategory} - ${item.productType}`;
      const truncated = truncateLabel(original);
      labelMap.set(truncated, original);
    });

    const xScale = d3
      .scaleLinear()
      .domain([0, d3.max(topData, (d) => d.bgcCount) ?? 0])
      .nice()
      .range([0, innerWidth]);

    const yScale = d3
      .scaleBand()
      .domain(topData.map((d) => truncateLabel(`${d.productCategory} - ${d.productType}`)))
      .range([0, innerHeight])
      .padding(0.2);

    const root = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    root
      .selectAll('rect')
      .data(topData)
      .join('rect')
      .attr('x', 0)
      .attr('y', (d) => yScale(truncateLabel(`${d.productCategory} - ${d.productType}`)) ?? 0)
      .attr('width', (d) => xScale(d.bgcCount))
      .attr('height', yScale.bandwidth())
      .attr('fill', (d, i) => getProductCategoryColor(d.productCategory, i))
      .attr('rx', 3)
      .style('cursor', 'pointer')
      .on('mouseenter', function (event, d) {
        d3.select(this).attr('opacity', 0.7);
        tooltip
          .style('opacity', 1)
          .style('left', `${event.clientX + 10}px`)
          .style('top', `${event.clientY - 10}px`)
          .html(`
            <strong>${d.productCategory}</strong><br/>
            ${d.productType}<br/>
            BGCs: ${d.bgcCount.toLocaleString()} (${d.percentage.toFixed(1)}%)
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
      .data(topData)
      .join('text')
      .attr('class', 'value')
      .attr('x', (d) => xScale(d.bgcCount) + 5)
      .attr('y', (d) => (yScale(truncateLabel(`${d.productCategory} - ${d.productType}`)) ?? 0) + yScale.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('font-size', '11px')
      .attr('fill', '#64748b')
      .text((d) => d.bgcCount.toLocaleString());

    const yAxis = root
      .append('g')
      .call(d3.axisLeft(yScale));

    yAxis
      .selectAll('text')
      .attr('font-size', '10px')
      .style('text-anchor', 'end')
      .style('cursor', 'help')
      .on('mouseover', function(event, truncatedLabel) {
        const originalLabel = labelMap.get(truncatedLabel as string) || truncatedLabel as string;

        tooltip
          .style('opacity', '1')
          .html(`<div class="text-xs">${originalLabel}</div>`)
          .style('left', `${event.clientX + 10}px`)
          .style('top', `${event.clientY - 10}px`);
      })
      .on('mousemove', (event) => {
        tooltip
          .style('left', `${event.clientX + 10}px`)
          .style('top', `${event.clientY - 10}px`);
      })
      .on('mouseout', () => {
        tooltip.style('opacity', '0');
      });

    root
      .append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(xScale).ticks(5))
      .selectAll('text')
      .attr('font-size', '10px');

    root
      .append('text')
      .attr('x', innerWidth / 2)
      .attr('y', innerHeight + 35)
      .attr('text-anchor', 'middle')
      .attr('font-size', '11px')
      .attr('fill', '#64748b')
      .text('Number of BGCs');
  }, [data, width, height, view]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <ChartViewToggle view={view} onChange={setView} />
      </div>
      {view === 'sunburst' ? (
        <Sunburst
          rows={sunburstRows}
          colorOf={getProductCategoryColor}
          // Assignments, not BGCs: a member can count under several categories, so
          // the centre total exceeds the member count.
          valueLabel="assignments"
          rootLabel="Product assignments"
          containerRef={sunburstRef}
        />
      ) : (
        <>
          <svg ref={svgRef} width={width} height={height} />
          <div
            ref={tooltipRef}
            className="pointer-events-none fixed z-50 rounded-sm border border-border bg-popover px-2.5 py-1.5 text-xs shadow-[0_4px_16px_-8px_rgba(0,0,0,0.15)]"
            style={{ opacity: 0 }}
          />
          {data.length > 15 && (
            <div className="text-center text-sm text-muted-foreground mt-4">
              Showing top 15 of {data.length} combinations
            </div>
          )}
        </>
      )}
    </div>
  );
};

interface GoldEcosystemData {
  goldLevel1: string | null;
  goldLevel2: string | null;
  goldLevel3: string | null;
  goldLevel4: string | null;
  goldLevel5: string | null;
  bgcCount: number;
  percentage: number;
}

interface GoldEcosystemChartProps {
  gcfId: string;
  width: number;
  height: number;
}

export const GoldEcosystemChart = ({ gcfId, width, height }: GoldEcosystemChartProps) => {
  // Fetched only when the section opens.
  const { data, isLoading, error, isFetching, refetch } = useGoldEcosystemDistribution(gcfId);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const sunburstRef = useRef<HTMLDivElement>(null);
  const [selectedLevel, setSelectedLevel] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [view, setView] = useState<ChartView>('sunburst');
  const sunburstRows = useMemo<SunburstRow[]>(
    () => data.map((d) => ({
      // goldLevelN are cumulative paths ("Environmental:Aquatic"); name nodes by the leaf.
      segments: [d.goldLevel1, d.goldLevel2, d.goldLevel3, d.goldLevel4, d.goldLevel5]
        .filter((s): s is string => Boolean(s))
        .map((s) => s.split(':').pop()?.trim() || s),
      value: d.bgcCount,
    })),
    [data],
  );

  useEffect(() => {
    if (view !== 'bars' || !svgRef.current || !tooltipRef.current || !data.length) return;

    const svg = d3.select<SVGSVGElement, unknown>(svgRef.current);
    const tooltip = d3.select<HTMLDivElement, unknown>(tooltipRef.current);
    svg.selectAll('*').remove();

    const getLevelKey = (d: GoldEcosystemData): string => {
      const levelMap: Record<number, keyof GoldEcosystemData> = {
        1: 'goldLevel1',
        2: 'goldLevel2',
        3: 'goldLevel3',
        4: 'goldLevel4',
        5: 'goldLevel5',
      };
      return (d[levelMap[selectedLevel]] as string) || 'Unknown';
    };

    const aggregated = Array.from(
      d3.rollup(
        data,
        v => d3.sum(v, d => d.bgcCount),
        d => getLevelKey(d)
      ),
      ([gold, count]) => ({ gold, count })
    ).sort((a, b) => b.count - a.count).slice(0, 15);

    const margin = { top: 20, right: 60, bottom: 60, left: 180 };
    const innerWidth = Math.max(0, width - margin.left - margin.right);
    const innerHeight = Math.max(0, height - margin.top - margin.bottom);

    const truncateLabel = (label: string, maxLength: number = 25): string => {
      if (label.length <= maxLength) return label;

      if (label.includes(':') || label.includes('>')) {
        const parts = label.split(/[:\>]/).map(p => p.trim());
        const lastPart = parts[parts.length - 1];
        if (lastPart.length <= maxLength) {
          return '...' + lastPart;
        }
      }

      return label.substring(0, maxLength - 3) + '...';
    };

    const labelMap = new Map<string, string>();
    aggregated.forEach((item) => {
      const original = item.gold;
      const truncated = truncateLabel(original);
      labelMap.set(truncated, original);
    });

    const xScale = d3
      .scaleLinear()
      .domain([0, d3.max(aggregated, (d) => d.count) ?? 0])
      .nice()
      .range([0, innerWidth]);

    const yScale = d3
      .scaleBand()
      .domain(aggregated.map((d) => truncateLabel(d.gold)))
      .range([0, innerHeight])
      .padding(0.2);

    const root = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    root
      .selectAll('rect')
      .data(aggregated)
      .join('rect')
      .attr('x', 0)
      .attr('y', (d) => yScale(truncateLabel(d.gold)) ?? 0)
      .attr('width', (d) => xScale(d.count))
      .attr('height', yScale.bandwidth())
      .attr('fill', (d, i) => getEcosystemColor(d.gold, i))
      .attr('rx', 3)
      .style('cursor', 'pointer')
      .on('mouseenter', function (event, d) {
        d3.select(this).attr('opacity', 0.7);
        const totalBgcs = d3.sum(aggregated, d => d.count);
        const percentage = (d.count / totalBgcs * 100).toFixed(1);
        tooltip
          .style('opacity', 1)
          .style('left', `${event.clientX + 10}px`)
          .style('top', `${event.clientY - 10}px`)
          .html(`
            <strong>${d.gold}</strong><br/>
            BGCs: ${d.count.toLocaleString()} (${percentage}%)
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
      .data(aggregated)
      .join('text')
      .attr('class', 'value')
      .attr('x', (d) => xScale(d.count) + 5)
      .attr('y', (d) => (yScale(truncateLabel(d.gold)) ?? 0) + yScale.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('font-size', '11px')
      .attr('fill', '#64748b')
      .text((d) => d.count.toLocaleString());

    const yAxis = root
      .append('g')
      .call(d3.axisLeft(yScale));

    yAxis
      .selectAll('text')
      .attr('font-size', '10px')
      .style('cursor', 'help')
      .on('mouseover', function(event, truncatedLabel) {
        const originalLabel = labelMap.get(truncatedLabel as string) || truncatedLabel as string;

        tooltip
          .style('opacity', '1')
          .html(`<div class="text-xs">${originalLabel}</div>`)
          .style('left', `${event.clientX + 10}px`)
          .style('top', `${event.clientY - 10}px`);
      })
      .on('mousemove', (event) => {
        tooltip
          .style('left', `${event.clientX + 10}px`)
          .style('top', `${event.clientY - 10}px`);
      })
      .on('mouseout', () => {
        tooltip.style('opacity', '0');
      });

    root
      .append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(xScale).ticks(5))
      .selectAll('text')
      .attr('font-size', '10px');
  }, [data, width, height, selectedLevel, view]);

  if (isLoading) {
    return (
      <div className="flex h-[420px] items-center justify-center text-sm text-muted-foreground">
        Loading ecosystem distribution…
      </div>
    );
  }
  // A failed request is not an empty family: say so, rather than claiming there
  // is no data.
  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-sm text-muted-foreground">
        Couldn&apos;t load the ecosystem distribution.
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? 'Retrying…' : 'Retry'}
        </Button>
      </div>
    );
  }
  if (data.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        No GOLD ecosystem data available for this GCF.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {view === 'bars' ? (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">GOLD Level:</span>
            <Select value={String(selectedLevel)} onValueChange={(v) => setSelectedLevel(Number(v) as 1 | 2 | 3 | 4 | 5)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Level 1 (Top-level)</SelectItem>
                <SelectItem value="2">Level 2</SelectItem>
                <SelectItem value="3">Level 3</SelectItem>
                <SelectItem value="4">Level 4</SelectItem>
                <SelectItem value="5">Level 5</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : (
          <span />
        )}
        <ChartViewToggle view={view} onChange={setView} />
      </div>
      {view === 'sunburst' ? (
        <Sunburst
          rows={sunburstRows}
          colorOf={getGOLDColorHex}
          pathColorOf={getGoldSubtreeColorHex}
          valueLabel="BGCs"
          rootLabel="All ecosystems"
          containerRef={sunburstRef}
        />
      ) : (
        <>
          <svg ref={svgRef} width={width} height={height} />
          <div
            ref={tooltipRef}
            className="pointer-events-none fixed z-50 rounded-sm border border-border bg-popover px-2.5 py-1.5 text-xs shadow-[0_4px_16px_-8px_rgba(0,0,0,0.15)]"
            style={{ opacity: 0 }}
          />
        </>
      )}
    </div>
  );
};

interface SourceTypeData {
  sourceType: string;
  assemblyCount: number;
  bgcCount: number;
  // BiG-SLiCE distance; lower = more similar.
  avgDistance: number | null;
}

interface SourceTypeChartProps {
  data: SourceTypeData[];
  width: number;
  height: number;
}

export const SourceTypeChart = ({ data, width, height }: SourceTypeChartProps) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!svgRef.current || !tooltipRef.current || !data.length) return;

    const svg = d3.select<SVGSVGElement, unknown>(svgRef.current);
    const tooltip = d3.select<HTMLDivElement, unknown>(tooltipRef.current);
    svg.selectAll('*').remove();

    const radius = Math.min(width, height) / 2 - 20;
    const innerRadius = radius * 0.6;

    const root = svg
      .append('g')
      .attr('transform', `translate(${width / 2},${height / 2})`);

    const color = d3.scaleOrdinal<string>()
      .domain(data.map(d => d.sourceType))
      .range(d3.schemeSet2);

    const pie = d3.pie<SourceTypeData>()
      .value(d => d.bgcCount)
      .sort(null);

    const arc = d3.arc<d3.PieArcDatum<SourceTypeData>>()
      .innerRadius(innerRadius)
      .outerRadius(radius);

    const outerArc = d3.arc<d3.PieArcDatum<SourceTypeData>>()
      .innerRadius(innerRadius)
      .outerRadius(radius + 5);

    root
      .selectAll<SVGPathElement, d3.PieArcDatum<SourceTypeData>>('path')
      .data(pie(data))
      .join('path')
      .attr('d', arc)
      .attr('fill', d => color(d.data.sourceType))
      .attr('stroke', 'white')
      .style('stroke-width', '2px')
      .style('cursor', 'pointer')
      .on('mouseenter', function (event, d) {
        d3.select<SVGPathElement, d3.PieArcDatum<SourceTypeData>>(this)
          .transition()
          .duration(200)
          .attr('d', outerArc);

        const total = d3.sum(data, d => d.bgcCount);
        const percentage = (d.data.bgcCount / total * 100).toFixed(1);
        tooltip
          .style('opacity', 1)
          .style('left', `${event.clientX + 10}px`)
          .style('top', `${event.clientY - 10}px`)
          .html(`
            <strong>${d.data.sourceType}</strong><br/>
            BGCs: ${d.data.bgcCount.toLocaleString()}<br/>
            Assemblies: ${d.data.assemblyCount.toLocaleString()}<br/>
            ${percentage}% of total
          `);
      })
      .on('mousemove', function (event) {
        tooltip
          .style('left', `${event.clientX + 10}px`)
          .style('top', `${event.clientY - 10}px`);
      })
      .on('mouseleave', function () {
        d3.select<SVGPathElement, d3.PieArcDatum<SourceTypeData>>(this)
          .transition()
          .duration(200)
          .attr('d', arc);
        tooltip.style('opacity', 0);
      });

    root
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '-0.5em')
      .attr('font-size', '24px')
      .attr('font-weight', 'bold')
      .attr('fill', '#0ea5e9')
      .text(d3.sum(data, d => d.bgcCount).toLocaleString());

    root
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '1.2em')
      .attr('font-size', '12px')
      .attr('fill', '#64748b')
      .text('Total BGCs');

    const legend = svg
      .append('g')
      .attr('transform', `translate(${width - 120}, 20)`);

    const legendItems = legend
      .selectAll('g')
      .data(data)
      .join('g')
      .attr('transform', (d, i) => `translate(0, ${i * 20})`);

    legendItems
      .append('rect')
      .attr('width', 12)
      .attr('height', 12)
      .attr('fill', d => color(d.sourceType))
      .attr('rx', 2);

    legendItems
      .append('text')
      .attr('x', 18)
      .attr('y', 10)
      .attr('font-size', '11px')
      .attr('fill', '#475569')
      .text(d => d.sourceType);
  }, [data, width, height]);

  return (
    <>
      <svg ref={svgRef} width={width} height={height} />
      <div
        ref={tooltipRef}
        className="pointer-events-none fixed z-50 rounded-sm border border-border bg-popover px-2.5 py-1.5 text-xs shadow-[0_4px_16px_-8px_rgba(0,0,0,0.15)]"
        style={{ opacity: 0 }}
      />
    </>
  );
};

interface MembershipScoreData {
  scores: number[];
  avg: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
}

interface MembershipScoreChartProps {
  data: MembershipScoreData;
  width: number;
  height: number;
}

export const MembershipScoreChart = ({ data, width, height }: MembershipScoreChartProps) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!svgRef.current || !tooltipRef.current || !data.scores.length) return;

    const svg = d3.select<SVGSVGElement, unknown>(svgRef.current);
    const tooltip = d3.select<HTMLDivElement, unknown>(tooltipRef.current);
    svg.selectAll('*').remove();

    const margin = { top: 20, right: 20, bottom: 60, left: 60 };
    const innerWidth = Math.max(0, width - margin.left - margin.right);
    const innerHeight = Math.max(0, height - margin.top - margin.bottom);

    const histogram = d3.histogram()
      .domain([0, 1])
      .thresholds(20);

    const bins = histogram(data.scores);

    const xScale = d3
      .scaleLinear()
      .domain([0, 1])
      .range([0, innerWidth]);

    const yScale = d3
      .scaleLinear()
      .domain([0, d3.max(bins, d => d.length) ?? 0])
      .nice()
      .range([innerHeight, 0]);

    const root = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    root
      .selectAll('rect')
      .data(bins)
      .join('rect')
      .attr('x', d => xScale(d.x0 ?? 0))
      .attr('y', d => yScale(d.length))
      .attr('width', d => Math.max(0, xScale(d.x1 ?? 0) - xScale(d.x0 ?? 0) - 1))
      .attr('height', d => innerHeight - yScale(d.length))
      .attr('fill', '#8b5cf6')
      .attr('rx', 2)
      .style('cursor', 'pointer')
      .on('mouseenter', function (event, d) {
        d3.select(this).attr('fill', '#7c3aed');
        tooltip
          .style('opacity', 1)
          .style('left', `${event.clientX + 10}px`)
          .style('top', `${event.clientY - 10}px`)
          .html(`
            <strong>Score Range: ${(d.x0 ?? 0).toFixed(2)} - ${(d.x1 ?? 0).toFixed(2)}</strong><br/>
            Count: ${d.length.toLocaleString()} BGCs
          `);
      })
      .on('mousemove', function (event) {
        tooltip
          .style('left', `${event.clientX + 10}px`)
          .style('top', `${event.clientY - 10}px`);
      })
      .on('mouseleave', function () {
        d3.select(this).attr('fill', '#8b5cf6');
        tooltip.style('opacity', 0);
      });

    if (data.median !== null) {
      root
        .append('line')
        .attr('x1', xScale(data.median))
        .attr('x2', xScale(data.median))
        .attr('y1', 0)
        .attr('y2', innerHeight)
        .attr('stroke', '#ef4444')
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '4,4');

      root
        .append('text')
        .attr('x', xScale(data.median))
        .attr('y', -5)
        .attr('text-anchor', 'middle')
        .attr('font-size', '10px')
        .attr('fill', '#ef4444')
        .text(`Median: ${data.median.toFixed(3)}`);
    }

    root
      .append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(xScale).ticks(10))
      .selectAll('text')
      .attr('font-size', '10px');

    root
      .append('g')
      .call(d3.axisLeft(yScale).ticks(5))
      .selectAll('text')
      .attr('font-size', '10px');

    root
      .append('text')
      .attr('x', innerWidth / 2)
      .attr('y', innerHeight + 45)
      .attr('text-anchor', 'middle')
      .attr('font-size', '11px')
      .attr('fill', '#64748b')
      .text('Membership Score');

    root
      .append('text')
      .attr('transform', 'rotate(-90)')
      .attr('x', -innerHeight / 2)
      .attr('y', -45)
      .attr('text-anchor', 'middle')
      .attr('font-size', '11px')
      .attr('fill', '#64748b')
      .text('Number of BGCs');
  }, [data, width, height]);

  return (
    <>
      <svg ref={svgRef} width={width} height={height} />
      <div
        ref={tooltipRef}
        className="pointer-events-none fixed z-50 rounded-sm border border-border bg-popover px-2.5 py-1.5 text-xs shadow-[0_4px_16px_-8px_rgba(0,0,0,0.15)]"
        style={{ opacity: 0 }}
      />
    </>
  );
};
