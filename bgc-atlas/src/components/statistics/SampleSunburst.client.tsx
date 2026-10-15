'use client';

import React, { useEffect, useRef } from 'react';
import * as d3 from '@/lib/d3';
import { TOOLTIP_CLASSES, useChartDimensions } from '@/lib/utils/chart-utils';
import { getGOLDColorHex, getGoldSubtreeColorHex } from '@/lib/utils/gold-parser';
import type { SampleHierarchyRow } from '@/lib/hooks/use-sample-stats';

type Metric = 'samples' | 'bgcs';

interface TreeDatum {
  name: string;
  directSamples: number;
  directBgcs: number;
  children: TreeDatum[];
  /** True for synthetic nodes that fill the "unknown" gap of a parent. */
  placeholder?: boolean;
}

interface ArcCoords {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

type SunNode = d3.HierarchyRectangularNode<TreeDatum> & {
  current: ArcCoords;
  target: ArcCoords;
  totalSamples: number;
  totalBgcs: number;
};

interface SampleSunburstProps {
  data: SampleHierarchyRow[];
  metric: Metric;
  containerRef: React.RefObject<HTMLDivElement | null>;
  unitLabel?: string;
}

function buildTree(rows: SampleHierarchyRow[]): TreeDatum {
  const root: TreeDatum = { name: 'All ecosystems', directSamples: 0, directBgcs: 0, children: [] };
  const childIndex = new Map<TreeDatum, Map<string, TreeDatum>>();
  const indexFor = (node: TreeDatum): Map<string, TreeDatum> => {
    let map = childIndex.get(node);
    if (!map) {
      map = new Map();
      childIndex.set(node, map);
    }
    return map;
  };

  for (const row of rows) {
    const segments = row.path.split(':').map((s) => s.trim()).filter(Boolean);
    let node = root;
    for (const seg of segments) {
      const map = indexFor(node);
      let child = map.get(seg);
      if (!child) {
        child = { name: seg, directSamples: 0, directBgcs: 0, children: [] };
        map.set(seg, child);
        node.children.push(child);
      }
      node = child;
    }
    node.directSamples += row.samples;
    node.directBgcs += row.bgcs;
  }
  // A node with a direct value and children would leave a blank arc in the outer
  // ring, so the direct value becomes a grey placeholder child.
  const fillGaps = (node: TreeDatum) => {
    if (node.children.length > 0 && (node.directSamples > 0 || node.directBgcs > 0)) {
      node.children.push({
        name: 'Unknown',
        directSamples: node.directSamples,
        directBgcs: node.directBgcs,
        children: [],
        placeholder: true,
      });
      node.directSamples = 0;
      node.directBgcs = 0;
    }
    node.children.forEach(fillGaps);
  };
  fillGaps(root);
  return root;
}

const PLACEHOLDER_FILL = '#d1d5db';

// Level-1 GOLD hue, lightened with depth; the Host-associated:Plants (green) and
// Environmental:Aquatic (blue) subtrees are the exceptions.
function arcFill(node: SunNode): string {
  if (node.data.placeholder) return PLACEHOLDER_FILL;
  let level1: SunNode = node;
  while (level1.depth > 1 && level1.parent) {
    level1 = level1.parent as SunNode;
  }
  const path = node.ancestors().reverse().slice(1).map((n) => n.data.name).join(':');
  const base = getGoldSubtreeColorHex(path) ?? getGOLDColorHex(level1.data.name);
  const c = d3.color(base);
  if (!c) return base;
  return c.brighter(Math.max(0, node.depth - 1) * 0.4).formatHex();
}

function labelColors(fill: string): { fill: string; halo: string } {
  const c = d3.color(fill)?.rgb();
  if (!c) return { fill: '#111827', halo: 'rgba(255,255,255,0.7)' };
  const lum = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
  return lum < 0.6
    ? { fill: '#ffffff', halo: 'rgba(0,0,0,0.45)' }
    : { fill: '#111827', halo: 'rgba(255,255,255,0.75)' };
}

const RING_LIMIT = 4; // show three rings at a time (depths 1..3 from current root)

const arcVisible = (d: ArcCoords) => d.y1 <= RING_LIMIT && d.y0 >= 1 && d.x1 > d.x0;
// Only label arcs wider than ~7° so radial labels do not collide.
const labelVisible = (d: ArcCoords) =>
  d.y1 <= RING_LIMIT && d.y0 >= 1 && d.x1 - d.x0 >= 0.12;

export const SampleSunburst = React.memo(function SampleSunburst({ data, metric, containerRef, unitLabel = 'samples' }: SampleSunburstProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const dimensions = useChartDimensions(containerRef);

  useEffect(() => {
    if (!svgRef.current || !tooltipRef.current || !dimensions.width || data.length === 0) return;

    const size = Math.max(260, Math.min(dimensions.width, 540));
    // The outermost visible ring (y1 === RING_LIMIT) must reach the viewBox edge.
    const radius = size / (2 * RING_LIMIT);

    const valueOf = (d: TreeDatum) => (metric === 'samples' ? d.directSamples : d.directBgcs);

    const root = d3
      .hierarchy<TreeDatum>(buildTree(data))
      .sum((d) => valueOf(d))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0)) as unknown as SunNode;

    // Both metrics on every node, so the tooltip can show the non-sized one too.
    root.eachAfter((node) => {
      const n = node as SunNode;
      const kids = (n.children as SunNode[] | undefined) ?? [];
      n.totalSamples = n.data.directSamples + kids.reduce((s, c) => s + c.totalSamples, 0);
      n.totalBgcs = n.data.directBgcs + kids.reduce((s, c) => s + c.totalBgcs, 0);
    });

    d3.partition<TreeDatum>().size([2 * Math.PI, root.height + 1])(root);
    root.each((d) => {
      const n = d as SunNode;
      n.current = { x0: n.x0, x1: n.x1, y0: n.y0, y1: n.y1 };
      n.target = n.current;
    });

    const arcGen = d3
      .arc<ArcCoords>()
      .startAngle((d) => d.x0)
      .endAngle((d) => d.x1)
      .padAngle((d) => Math.min((d.x1 - d.x0) / 2, 0.005))
      .padRadius(radius * 1.5)
      .innerRadius((d) => d.y0 * radius)
      .outerRadius((d) => Math.max(d.y0 * radius, d.y1 * radius - 1));
    const drawArc = (d: ArcCoords) => arcGen(d) ?? '';

    const labelTransform = (d: ArcCoords) => {
      const x = ((d.x0 + d.x1) / 2) * (180 / Math.PI);
      const y = ((d.y0 + d.y1) / 2) * radius;
      return `rotate(${x - 90}) translate(${y},0) rotate(${x < 180 ? 0 : 180})`;
    };

    const svg = d3.select<SVGSVGElement, undefined>(svgRef.current);
    svg.selectAll('*').remove();
    svg
      .attr('viewBox', `${-size / 2} ${-size / 2} ${size} ${size}`)
      .attr('width', size)
      .attr('height', size)
      .style('max-width', '100%')
      .style('height', 'auto')
      .style('font', '10px var(--font-sans, sans-serif)');

    const g = svg.append('g');
    const nodes = root.descendants().slice(1) as SunNode[];

    const tooltip = d3.select<HTMLDivElement, undefined>(tooltipRef.current);
    const showTip = (event: MouseEvent, d: SunNode) => {
      const label = d.ancestors().reverse().slice(1).map((n) => n.data.name).join(' › ');
      tooltip
        .classed(TOOLTIP_CLASSES, true)
        .style('opacity', '1')
        .html(
          `<div class="font-medium">${label}</div><div>${d.totalSamples.toLocaleString()} ${unitLabel} · ${d.totalBgcs.toLocaleString()} BGCs</div>`,
        )
        .style('left', `${event.clientX + 14}px`)
        .style('top', `${event.clientY - 12}px`);
    };
    const moveTip = (event: MouseEvent) => {
      tooltip.style('left', `${event.clientX + 14}px`).style('top', `${event.clientY - 12}px`);
    };
    const hideTip = () => tooltip.style('opacity', '0');

    const path = g
      .append('g')
      .selectAll<SVGPathElement, SunNode>('path')
      .data(nodes)
      .join('path')
      .attr('fill', (d) => arcFill(d))
      .attr('fill-opacity', (d) => (arcVisible(d.current) ? (d.children ? 0.85 : 0.6) : 0))
      .attr('pointer-events', (d) => (arcVisible(d.current) ? 'auto' : 'none'))
      .attr('d', (d) => drawArc(d.current));

    path
      .style('cursor', 'pointer')
      .on('click', (_event, d) => clicked(d))
      .on('mouseover', (event, d) => showTip(event, d))
      .on('mousemove', (event) => moveTip(event))
      .on('mouseout', hideTip);

    const label = g
      .append('g')
      .attr('pointer-events', 'none')
      .attr('text-anchor', 'middle')
      .style('user-select', 'none')
      .selectAll<SVGTextElement, SunNode>('text')
      .data(nodes)
      .join('text')
      .attr('dy', '0.35em')
      .style('font-size', '11px')
      .style('font-weight', '500')
      .style('paint-order', 'stroke')
      .style('stroke-linejoin', 'round')
      .style('stroke-width', '1.5px')
      .attr('fill', (d) => labelColors(arcFill(d)).fill)
      .style('stroke', (d) => labelColors(arcFill(d)).halo)
      .attr('opacity', (d) => (labelVisible(d.current) ? 1 : 0))
      .attr('transform', (d) => labelTransform(d.current))
      .text((d) => (d.data.name.length > 18 ? `${d.data.name.slice(0, 17)}…` : d.data.name));

    const centerText = g.append('text').attr('text-anchor', 'middle').attr('pointer-events', 'none');
    const renderCenter = (d: SunNode) => {
      centerText.selectAll('*').remove();
      centerText
        .append('tspan')
        .attr('x', 0)
        .attr('y', '-0.2em')
        .style('font-weight', '600')
        .style('font-size', '12px')
        .attr('fill', '#111827')
        .text(d.depth === 0 ? 'All ecosystems' : d.data.name);
      const val = metric === 'samples' ? d.totalSamples : d.totalBgcs;
      centerText
        .append('tspan')
        .attr('x', 0)
        .attr('y', '1.1em')
        .style('font-size', '11px')
        .attr('fill', '#6b7280')
        .text(`${val.toLocaleString()} ${metric === 'samples' ? unitLabel : 'BGCs'}`);
    };
    renderCenter(root);

    const centerCircle = g
      .append('circle')
      .datum(root)
      .attr('r', radius)
      .attr('fill', 'none')
      .attr('pointer-events', 'all')
      .style('cursor', 'pointer')
      .on('click', (_event, d) => clicked(d as SunNode));

    function clicked(p: SunNode) {
      const target = p.depth === undefined ? root : p;
      centerCircle.datum(target.parent ?? root);
      renderCenter(target);

      root.each((d) => {
        const n = d as SunNode;
        n.target = {
          x0: Math.max(0, Math.min(1, (n.x0 - target.x0) / (target.x1 - target.x0))) * 2 * Math.PI,
          x1: Math.max(0, Math.min(1, (n.x1 - target.x0) / (target.x1 - target.x0))) * 2 * Math.PI,
          y0: Math.max(0, n.y0 - target.depth),
          y1: Math.max(0, n.y1 - target.depth),
        };
      });

      const DURATION = 650;

      path
        .transition()
        .duration(DURATION)
        .tween('data', (d) => {
          const i = d3.interpolate(d.current, d.target);
          return (time: number) => {
            d.current = i(time);
          };
        })
        .filter(function (this: SVGPathElement, d) {
          return Number(this.getAttribute('fill-opacity')) > 0 || arcVisible(d.target);
        })
        .attr('fill-opacity', (d) => (arcVisible(d.target) ? (d.children ? 0.85 : 0.6) : 0))
        .attr('pointer-events', (d) => (arcVisible(d.target) ? 'auto' : 'none'))
        .attrTween('d', (d) => () => drawArc(d.current));

      label
        .filter(function (this: SVGTextElement, d) {
          return Number(this.getAttribute('opacity')) > 0 || labelVisible(d.target);
        })
        .transition()
        .duration(DURATION)
        .attr('opacity', (d) => (labelVisible(d.target) ? 1 : 0))
        .attrTween('transform', (d) => () => labelTransform(d.current));
    }
  }, [data, metric, dimensions, unitLabel]);

  return (
    <div ref={containerRef} className="relative flex w-full justify-center">
      <svg ref={svgRef} role="img" aria-label="GOLD ecosystem sunburst" />
      <div ref={tooltipRef} className={TOOLTIP_CLASSES} style={{ opacity: 0 }} />
    </div>
  );
});
