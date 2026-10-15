"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from '@/lib/d3';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartSkeleton } from '@/components/ui/chart-skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  CHART_COLORS,
  CHART_MARGINS,
  CHART_STYLES,
  TOOLTIP_CLASSES,
  useChartDimensions,
  getResponsiveFontSize,
  getResponsiveMargins,
  countAxisLabels,
  countTickFormat,
  fitYAxisMargin,
  getProductCategoryColor,
} from '@/lib/utils/chart-utils';
import { HorizontalBarChart } from '@/components/charts/horizontal-bar-chart';
import { useGcfStats, type ProductDistribution, type SizeDistribution, type RawSizeDistribution, type GcfStats } from '@/lib/hooks/use-gcf-stats';
import { useGcfDistribution } from '@/lib/hooks/use-gcf-distribution';
import type { UseGcfsParams } from '@/lib/hooks/use-gcfs';
import { useQuery } from '@tanstack/react-query';
import { withBase } from '@/lib/basePath';

type StaticGcfChartsManifest = { version: string; url: string };

interface SizeChartProps {
  data: SizeDistribution[];
  containerRef: React.RefObject<HTMLDivElement | null>;
}

// Single series, so the lead hue rather than "success": a family's size is not an outcome.
const SIZE_COLOR = CHART_COLORS.primary;
const SIZE_HOVER_COLOR = d3.color(SIZE_COLOR)?.darker(0.7).formatHex() ?? SIZE_COLOR;

const SizeDistributionChart = ({ data, containerRef }: SizeChartProps) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const dimensions = useChartDimensions(containerRef);

  useEffect(() => {
    if (!svgRef.current || !tooltipRef.current || !data.length || !dimensions.width) return;

    const svg = d3.select<SVGSVGElement, unknown>(svgRef.current);
    const tooltip = d3.select<HTMLDivElement, unknown>(tooltipRef.current);

    const baseMargins = CHART_MARGINS.withBottomLabels;
    const fontSize = getResponsiveFontSize(dimensions.width, CHART_STYLES.fontSize.label);
    const maxCount = d3.max(data, (d) => d.count) ?? 0;
    const yTickFormat = countTickFormat(dimensions.width);
    const responsiveMargin = getResponsiveMargins(dimensions.width, baseMargins);
    const yAxisFit = fitYAxisMargin(svgRef.current, {
      labels: countAxisLabels(maxCount, 5, yTickFormat), fontSize: fontSize - 1,
      min: responsiveMargin.left, titleFontSize: fontSize,
    });
    const margin = { ...responsiveMargin, left: yAxisFit.left };

    const height = Math.max(300, Math.min(500, dimensions.width * 0.7));

    const innerWidth = Math.max(0, dimensions.width - margin.left - margin.right);
    const innerHeight = Math.max(0, height - margin.top - margin.bottom);

    svg.attr('width', dimensions.width).attr('height', height);

    const xScale = d3
      .scaleBand()
      .domain(data.map((d) => d.range))
      .range([0, innerWidth])
      .padding(0.3);

    const yScale = d3
      .scaleLinear()
      .domain([0, maxCount])
      .nice()
      .range([innerHeight, 0]);

    let root = svg.select<SVGGElement>('g.chart-root');
    if (root.empty()) {
      root = svg.append('g').attr('class', 'chart-root');
    }
    root.attr('transform', `translate(${margin.left},${margin.top})`);

    const bars = root
      .selectAll<SVGRectElement, SizeDistribution>('rect.bar')
      .data(data, (d) => d.range);

    bars
      .enter()
      .append('rect')
      .attr('class', 'bar')
      .attr('x', (d) => xScale(d.range) ?? 0)
      .attr('y', innerHeight)
      .attr('width', xScale.bandwidth())
      .attr('height', 0)
      .attr('rx', 1)
      .attr('fill', SIZE_COLOR)
      .style('cursor', 'pointer')
      .merge(bars)
      .on('mouseenter', function (event, d) {
        d3.select(this).attr('fill', SIZE_HOVER_COLOR);
        tooltip
          .classed(TOOLTIP_CLASSES, true)
          .style('opacity', '1')
          .style('left', `${event.clientX + 10}px`)
          .style('top', `${event.clientY - 10}px`)
          .html(`<strong>${d.range} BGCs</strong><br/>GCFs: ${d.count.toLocaleString()}`);
      })
      .on('mousemove', function (event) {
        tooltip
          .style('left', `${event.clientX + 10}px`)
          .style('top', `${event.clientY - 10}px`);
      })
      .on('mouseleave', function () {
        d3.select(this).attr('fill', SIZE_COLOR);
        tooltip.style('opacity', '0');
      })
      .transition()
      .duration(CHART_STYLES.transitionDuration)
      .attr('x', (d) => xScale(d.range) ?? 0)
      .attr('y', (d) => yScale(d.count))
      .attr('width', xScale.bandwidth())
      .attr('height', (d) => innerHeight - yScale(d.count));

    bars.exit().remove();

    const labels = root
      .selectAll<SVGTextElement, SizeDistribution>('text.value')
      .data(data, (d) => d.range);

    labels
      .enter()
      .append('text')
      .attr('class', 'value')
      .attr('x', (d) => (xScale(d.range) ?? 0) + xScale.bandwidth() / 2)
      .attr('y', innerHeight)
      .attr('text-anchor', 'middle')
      .attr('font-size', `${fontSize}px`)
      .style('fill', 'var(--muted-foreground)')
      .merge(labels)
      .transition()
      .duration(CHART_STYLES.transitionDuration)
      .attr('x', (d) => (xScale(d.range) ?? 0) + xScale.bandwidth() / 2)
      .attr('y', (d) => yScale(d.count) - 5)
      .text((d) => d.count.toLocaleString());

    labels.exit().remove();

    let xAxis = root.select<SVGGElement>('g.x-axis');
    if (xAxis.empty()) {
      xAxis = root.append('g').attr('class', 'x-axis');
    }
    xAxis
      .attr('transform', `translate(0,${innerHeight})`)
      .transition()
      .duration(CHART_STYLES.transitionDuration)
      .call(d3.axisBottom(xScale))
      .selectAll('text')
      .attr('font-size', `${fontSize - 1}px`)
      .attr('transform', 'rotate(-45)')
      .style('text-anchor', 'end');

    let yAxis = root.select<SVGGElement>('g.y-axis');
    if (yAxis.empty()) {
      yAxis = root.append('g').attr('class', 'y-axis');
    }
    yAxis
      .transition()
      .duration(CHART_STYLES.transitionDuration)
      .call(d3.axisLeft(yScale).ticks(5).tickFormat((d) => yTickFormat(Number(d))))
      .selectAll('text')
      .attr('font-size', `${fontSize - 1}px`);

    let yAxisLabel = root.select<SVGTextElement>('text.y-axis-label');
    if (yAxisLabel.empty()) {
      yAxisLabel = root.append('text').attr('class', 'y-axis-label');
    }
    yAxisLabel
      .attr('transform', 'rotate(-90)')
      .attr('x', -innerHeight / 2)
      .attr('y', yAxisFit.titleY)
      .attr('text-anchor', 'middle')
      .attr('font-size', `${fontSize}px`)
      .style('fill', 'var(--muted-foreground)')
      .text('Number of GCFs');

  }, [data, dimensions]);

  return (
    <div ref={containerRef} className="relative w-full">
      <svg ref={svgRef} className="w-full" role="img" aria-hidden="true" />
      <div ref={tooltipRef} className={TOOLTIP_CLASSES} style={{ opacity: 0 }} />
    </div>
  );
};

interface RankPlotProps {
  data: RawSizeDistribution[];
  containerRef: React.RefObject<HTMLDivElement | null>;
}

const SizeRankPlot = ({ data, containerRef }: RankPlotProps) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const dimensions = useChartDimensions(containerRef);

  useEffect(() => {
    if (!svgRef.current || !tooltipRef.current || !data.length || !dimensions.width) return;

    // Size 0 breaks the log scale.
    const filteredData = data.filter(d => d.size > 0);
    if (!filteredData.length) return;

    const svg = d3.select<SVGSVGElement, unknown>(svgRef.current);
    const tooltip = d3.select<HTMLDivElement, unknown>(tooltipRef.current);

    const fontSize = getResponsiveFontSize(dimensions.width, CHART_STYLES.fontSize.label);
    const yMaxCount = Math.max(1, d3.max(filteredData, (d) => d.count) ?? 0);
    // Domain only: the labels a log axis draws do not depend on its range.
    const yLabelScale = d3.scaleLog().domain([1, yMaxCount]).nice();
    const yLabelFormat = yLabelScale.tickFormat(5, '~s');
    const responsiveMargin = getResponsiveMargins(dimensions.width, CHART_MARGINS.default);
    const yAxisFit = fitYAxisMargin(svgRef.current, {
      labels: yLabelScale.ticks(5).map(yLabelFormat), fontSize: fontSize - 1,
      min: responsiveMargin.left, titleFontSize: fontSize,
    });
    const margin = { ...responsiveMargin, left: yAxisFit.left };

    const height = Math.max(300, Math.min(500, dimensions.width * 0.7));

    const innerWidth = Math.max(0, dimensions.width - margin.left - margin.right);
    const innerHeight = Math.max(0, height - margin.top - margin.bottom);

    svg.attr('width', dimensions.width).attr('height', height);

    const xExtent = d3.extent(filteredData, d => d.size) as [number, number];
    const yExtent = [0, d3.max(filteredData, d => d.count) ?? 0] as [number, number];

    const xScale = d3.scaleLog().domain([Math.max(1, xExtent[0]), xExtent[1]]).range([0, innerWidth]).nice();
    const yScale = d3.scaleLog().domain([1, Math.max(1, yExtent[1])]).range([innerHeight, 0]).nice();

    let root = svg.select<SVGGElement>('g.chart-root');
    if (root.empty()) {
      root = svg.append('g').attr('class', 'chart-root');
    }
    root.attr('transform', `translate(${margin.left},${margin.top})`);

    // From a few hundred BGCs up most sizes are held by exactly one family, which drew
    // a solid smear of dots along y=1; those are drawn as one band instead.
    const bySize = [...filteredData].sort((a, b) => a.size - b.size);
    const ones = bySize.filter((d) => d.count === 1);
    // A handful of lone sizes are clearer as dots than as a band.
    const banded = ones.length >= 10 ? ones : [];
    const dotData = banded.length ? bySize.filter((d) => d.count !== 1) : bySize;

    let band = root.select<SVGRectElement>('rect.tail-band');
    if (banded.length) {
      if (band.empty()) band = root.append('rect').attr('class', 'tail-band');
      const x0 = xScale(banded[0].size) - 4;
      const x1 = xScale(banded[banded.length - 1].size) + 4;
      band
        .attr('x', x0)
        .attr('width', Math.max(8, x1 - x0))
        .attr('y', yScale(1) - 4)
        .attr('height', 8)
        .attr('rx', 4)
        .attr('fill', SIZE_COLOR)
        .attr('opacity', 0.3)
        .style('cursor', 'help')
        .on('mouseenter', function (event) {
          d3.select(this).attr('opacity', 0.5);
          tooltip
            .classed(TOOLTIP_CLASSES, true)
            .style('opacity', '1')
            .style('left', `${event.clientX + 10}px`)
            .style('top', `${event.clientY - 10}px`)
            .html(
              `<strong>${banded.length.toLocaleString()} sizes held by one family each</strong>`
              + `<br/>Between ${banded[0].size.toLocaleString()} and ${banded[banded.length - 1].size.toLocaleString()} BGCs`,
            );
        })
        .on('mousemove', function (event) {
          tooltip
            .style('left', `${event.clientX + 10}px`)
            .style('top', `${event.clientY - 10}px`);
        })
        .on('mouseleave', function () {
          d3.select(this).attr('opacity', 0.3);
          tooltip.style('opacity', '0');
        });
    } else {
      band.remove();
    }

    const dots = root.selectAll<SVGCircleElement, RawSizeDistribution>('circle.dot')
      .data(dotData, d => d.size);

    dots.enter()
      .append('circle')
      .attr('class', 'dot')
      .attr('r', 4)
      .attr('fill', SIZE_COLOR)
      .attr('opacity', 0.6)
      .attr('cx', d => xScale(d.size) || 0)
      .attr('cy', d => yScale(Math.max(1, d.count)) || 0)
      .style('cursor', 'pointer')
      .merge(dots)
      .on('mouseenter', function (event, d) {
        d3.select(this).attr('opacity', 1).attr('r', 6);
        tooltip
          .classed(TOOLTIP_CLASSES, true)
          .style('opacity', '1')
          .style('left', `${event.clientX + 10}px`)
          .style('top', `${event.clientY - 10}px`)
          .html(`<strong>Size: ${d.size} BGCs</strong><br/>GCFs: ${d.count.toLocaleString()}`);
      })
      .on('mousemove', function (event) {
        tooltip
          .style('left', `${event.clientX + 10}px`)
          .style('top', `${event.clientY - 10}px`);
      })
      .on('mouseleave', function () {
        d3.select(this).attr('opacity', 0.6).attr('r', 4);
        tooltip.style('opacity', '0');
      })
      .transition()
      .duration(CHART_STYLES.transitionDuration)
      .attr('cx', d => xScale(d.size) || 0)
      .attr('cy', d => yScale(Math.max(1, d.count)) || 0);

    dots.exit().remove();

    let xAxis = root.select<SVGGElement>('g.x-axis');
    if (xAxis.empty()) {
      xAxis = root.append('g').attr('class', 'x-axis');
    }
    xAxis
      .attr('transform', `translate(0,${innerHeight})`)
      .transition()
      .duration(CHART_STYLES.transitionDuration)
      .call(d3.axisBottom(xScale).ticks(5, "~s"))
      .selectAll('text')
      .attr('font-size', `${fontSize - 1}px`);

    let yAxis = root.select<SVGGElement>('g.y-axis');
    if (yAxis.empty()) {
      yAxis = root.append('g').attr('class', 'y-axis');
    }
    yAxis
      .transition()
      .duration(CHART_STYLES.transitionDuration)
      .call(d3.axisLeft(yScale).ticks(5, "~s"))
      .selectAll('text')
      .attr('font-size', `${fontSize - 1}px`);

    let xAxisLabel = root.select<SVGTextElement>('text.x-axis-label');
    if (xAxisLabel.empty()) {
      xAxisLabel = root.append('text').attr('class', 'x-axis-label');
    }
    xAxisLabel
      .attr('x', innerWidth / 2)
      .attr('y', innerHeight + margin.bottom - 5)
      .attr('text-anchor', 'middle')
      .attr('font-size', `${fontSize}px`)
      .style('fill', 'var(--muted-foreground)')
      .text('GCF size (number of BGCs)');

    let yAxisLabel = root.select<SVGTextElement>('text.y-axis-label');
    if (yAxisLabel.empty()) {
      yAxisLabel = root.append('text').attr('class', 'y-axis-label');
    }
    yAxisLabel
      .attr('transform', 'rotate(-90)')
      .attr('x', -innerHeight / 2)
      .attr('y', yAxisFit.titleY)
      .attr('text-anchor', 'middle')
      .attr('font-size', `${fontSize}px`)
      .style('fill', 'var(--muted-foreground)')
      .text('Number of GCFs');

  }, [data, dimensions]);

  return (
    <div ref={containerRef} className="relative w-full">
      <svg ref={svgRef} className="w-full" role="img" aria-hidden="true" />
      <div ref={tooltipRef} className={TOOLTIP_CLASSES} style={{ opacity: 0 }} />
    </div>
  );
};

interface GcfChartsProps {
  onProductCategorySelect?: (category: string) => void;
  /** Manifest URL of a pre-generated snapshot (scripts/generate-gcf-charts-snapshot.ts); omitted = live API. */
  staticManifestUrl?: string;
  /** The table's `useGcfs` params; when `filtered`, the charts re-aggregate over exactly these families. */
  params?: UseGcfsParams;
  filtered?: boolean;
}

/** Stable identity so an unfiltered render does not rebuild the query key. */
const NO_PARAMS: UseGcfsParams = {};

export function GcfCharts({ onProductCategorySelect, staticManifestUrl, params, filtered = false }: GcfChartsProps) {
  const sizeContainerRef = useRef<HTMLDivElement>(null);
  const useStatic = Boolean(staticManifestUrl);

  // Browser-cached forever via the hashed URL in the manifest.
  const staticQuery = useQuery({
    queryKey: ['gcf-charts-snapshot', staticManifestUrl],
    enabled: useStatic,
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async ({ signal }) => {
      const manifestRes = await fetch(withBase(staticManifestUrl!), { signal, cache: 'no-cache' });
      if (!manifestRes.ok) throw new Error(`GCF charts manifest fetch failed: ${manifestRes.status}`);
      const manifest = (await manifestRes.json()) as StaticGcfChartsManifest;
      const dataRes = await fetch(withBase(manifest.url), { signal });
      if (!dataRes.ok) throw new Error(`GCF charts data fetch failed: ${dataRes.status}`);
      return (await dataRes.json()) as GcfStats;
    },
  });

  const liveQuery = useGcfStats({ enabled: !useStatic });

  // Always called so hook order is stable across a filter toggle.
  const live = useGcfDistribution(params ?? NO_PARAMS, { enabled: filtered });

  const snapshot = useStatic ? (staticQuery.data ?? null) : liveQuery.data;

  // Negative operators and biome/taxonomy/productClass conditions go to the SQL fallback, which
  // the aggregation cannot reproduce; there the corpus snapshot stays, labelled as such.
  const showingLive = filtered && !live.unsupported && !live.error && Boolean(live.data);

  const data: GcfStats | null = showingLive ? live.data! : snapshot;
  const categoryBars = useMemo(
    () => (data?.categoryDistribution ?? []).map((d: ProductDistribution, i: number) => ({
      key: d.category,
      label: d.category,
      value: d.count,
      color: getProductCategoryColor(d.category, i),
      details: [`${d.count.toLocaleString()} families`],
    })),
    [data],
  );
  const isLoading = (useStatic ? staticQuery.isLoading : liveQuery.isLoading)
    // Otherwise a filtered URL briefly draws the corpus under an "all N GCFs" caption.
    || (filtered && live.isLoading);
  const error = useStatic
    ? ((staticQuery.error as Error | null) ?? null)
    : liveQuery.error;
  const [sizeViewType, setSizeViewType] = useState<'binned' | 'rank'>('rank');

  if (error) {
    return (
      <Card className="mb-8">
        <CardContent className="py-12 text-center text-red-600">
          <p>Failed to load GCF statistics</p>
          <p className="text-sm text-muted-foreground">{error.message}</p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-8 lg:only:col-span-2 lg:only:grid lg:only:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Category distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartSkeleton height={400} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>GCF size distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartSkeleton height={400} />
          </CardContent>
        </Card>
      </div>
    );
  }

  // The snapshot has no family total; every family lands in exactly one size bin, so the bins sum to it.
  const corpusTotal = snapshot
    ? snapshot.sizeDistribution.reduce((sum, row) => sum + row.count, 0) || undefined
    : undefined;

  // Shown only when a filter exists that the aggregation could not honour.
  const unfilteredNote = !filtered
    ? undefined
    : corpusTotal !== undefined
      ? `all ${corpusTotal.toLocaleString()} GCFs · not filtered by your current selection`
      : 'not filtered by your current selection';

  // Families can carry several categories, so these bars sum past the family count.
  const productCoverage = showingLive
    ? `${live.data!.totalGcfs.toLocaleString()} GCFs matching your filters`
      + ' · a family can carry several categories'
    : unfilteredNote;

  const sizeCoverage = showingLive
    ? `${live.data!.totalGcfs.toLocaleString()} GCFs matching your filters`
    : unfilteredNote;

  const showCategory = data.categoryDistribution.length > 0;
  const showSize = data.sizeDistribution.length > 0;
  if (!showCategory && !showSize) return null;

  return (
    /* On /gcfs the two cards stack beside the taxonomy heatmap and the page grid makes
       both columns one height. Where the heatmap hides itself this is the grid's only
       child, and the cards sit side by side at their own heights. */
    <div className={`flex flex-col gap-8 lg:only:col-span-2 ${showCategory && showSize ? 'lg:only:grid lg:only:grid-cols-2 lg:only:items-start' : ''}`}>
      {showCategory && <Card className="grow">
        <CardHeader>
          <CardTitle>Category distribution</CardTitle>
        </CardHeader>
        {productCoverage && <div className="-mt-2 px-6 pb-3 text-xs text-muted-foreground">{productCoverage}</div>}
        <CardContent>
          <HorizontalBarChart
            data={categoryBars}
            label="Families by product category"
            onSelect={onProductCategorySelect ? (d) => onProductCategorySelect(d.key) : undefined}
          />
        </CardContent>
      </Card>}

      {showSize && <Card className="grow">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle>GCF size distribution</CardTitle>
          <Select
            value={sizeViewType}
            onValueChange={(value: 'binned' | 'rank') => setSizeViewType(value)}
          >
            <SelectTrigger className="h-8 w-[136px] text-xs">
              <SelectValue placeholder="Select view" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="binned">Binned</SelectItem>
              {/* Families per exact size on log-log axes. Not a rank plot: the x
                  axis is a family's size, not its rank. */}
              <SelectItem value="rank">Size frequency</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        {sizeCoverage && <div className="-mt-2 px-6 pb-3 text-xs text-muted-foreground">{sizeCoverage}</div>}
        <CardContent>
          {sizeViewType === 'binned' ? (
            <SizeDistributionChart
              data={data.sizeDistribution}
              containerRef={sizeContainerRef}
            />
          ) : (
            <SizeRankPlot
              data={data.fullSizeDistribution}
              containerRef={sizeContainerRef}
            />
          )}
        </CardContent>
      </Card>}
    </div>
  );
}
