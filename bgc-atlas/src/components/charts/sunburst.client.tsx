'use client';

import React, { useEffect, useRef } from 'react';
import * as d3 from '@/lib/d3';
import { TOOLTIP_CLASSES, useChartDimensions } from '@/lib/utils/chart-utils';

export interface SunburstRow {
  segments: string[];
  value: number;
  /**
   * Shown before the path in the tooltip, for a level the rings leave out --
   * the domain, when a taxonomy sunburst starts at phylum.
   */
  context?: string;
}

interface TreeDatum {
  name: string;
  direct: number;
  children: TreeDatum[];
  placeholder?: boolean;
  /** True for the synthetic "Other" node that holds a parent's small children. */
  other?: boolean;
  /** Tooltip prefix carried from the rows (see SunburstRow.context). */
  context?: string;
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
};

interface SunburstProps {
  rows: SunburstRow[];
  colorOf: (level1: string) => string;
  /** Overrides colorOf for a full ':'-joined path, to recolor one subtree. */
  pathColorOf?: (path: string) => string | null;
  /** Depth whose segment drives an arc's base color; use 2 when level 1 is near-uniform (e.g. domain). */
  colorDepth?: number;
  valueLabel: string;
  rootLabel?: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  /**
   * Fold siblings smaller than this share of the whole (e.g. 0.005) into one
   * grey "Other (N)" arc. Its members are not drawn until it is clicked, so a
   * long tail of hairline slivers reads as one labelled arc. Off by default.
   */
  minShare?: number;
}

function buildTree(rows: SunburstRow[], rootLabel: string): TreeDatum {
  const root: TreeDatum = { name: rootLabel, direct: 0, children: [] };
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
    const segments = row.segments.map((s) => (s ?? '').trim()).filter(Boolean);
    if (segments.length === 0) continue;
    let node = root;
    for (const seg of segments) {
      const map = indexFor(node);
      let child = map.get(seg);
      if (!child) {
        child = { name: seg, direct: 0, children: [], context: row.context };
        map.set(seg, child);
        node.children.push(child);
      }
      node = child;
    }
    node.direct += row.value;
  }
  // A node with both a direct value and children would leave a blank outer arc;
  // move the direct value into a placeholder child.
  const fillGaps = (node: TreeDatum) => {
    if (node.children.length > 0 && node.direct > 0) {
      node.children.push({ name: 'Unknown', direct: node.direct, children: [], placeholder: true });
      node.direct = 0;
    }
    node.children.forEach(fillGaps);
  };
  fillGaps(root);
  return root;
}

const subtotal = (node: TreeDatum): number =>
  node.direct + node.children.reduce((sum, child) => sum + subtotal(child), 0);

/**
 * Move every child below `minValue` into one "Other" child, at every level.
 * Only when at least two would move: an "Other (1)" hides a name and saves
 * nothing. The moved nodes keep their subtrees, so zooming into "Other" shows
 * them whole.
 */
function foldSmall(node: TreeDatum, minValue: number): void {
  const small = node.children.filter((child) => !child.placeholder && subtotal(child) < minValue);
  if (small.length >= 2) {
    const keep = node.children.filter((child) => !small.includes(child));
    node.children = [...keep, { name: `Other (${small.length})`, direct: 0, children: small, other: true }];
  }
  for (const child of node.children) {
    if (!child.other) foldSmall(child, minValue);
  }
}

function labelColors(fill: string): { fill: string; halo: string } {
  const c = d3.color(fill)?.rgb();
  if (!c) return { fill: '#111827', halo: 'rgba(255,255,255,0.7)' };
  const lum = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
  return lum < 0.6
    ? { fill: '#ffffff', halo: 'rgba(0,0,0,0.45)' }
    : { fill: '#111827', halo: 'rgba(255,255,255,0.75)' };
}

const RING_LIMIT = 4; // three rings visible at a time
const arcVisible = (d: ArcCoords) => d.y1 <= RING_LIMIT && d.y0 >= 1 && d.x1 > d.x0;
const labelVisible = (d: ArcCoords) =>
  d.y1 <= RING_LIMIT && d.y0 >= 1 && d.x1 - d.x0 >= 0.12;

export const Sunburst = React.memo(function Sunburst({ rows, colorOf, pathColorOf, colorDepth = 1, valueLabel, rootLabel = 'All', containerRef, minShare }: SunburstProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const dimensions = useChartDimensions(containerRef);
  // Keyed on the drawn size, not the container's dimensions: the container's height
  // changes as soon as the first draw lands, which would build every chart twice.
  const size = dimensions.width ? Math.max(260, Math.min(dimensions.width, 540)) : 0;

  useEffect(() => {
    if (!svgRef.current || !tooltipRef.current || !size || rows.length === 0) return;

    const radius = size / (2 * RING_LIMIT);

    const PLACEHOLDER_FILL = '#d1d5db';
    const ABOVE_ANCHOR_FILL = '#d1d5db';
    const anchorDepth = Math.max(1, colorDepth);
    // An "Other" node adds a ring that is not a level of the hierarchy, so
    // depths for colouring count only real nodes.
    const levelOf = (node: SunNode): number =>
      node.ancestors().filter((n) => n.depth > 0 && !n.data.other).length;
    const fillOf = (node: SunNode): string => {
      if (node.data.placeholder || node.data.other) return PLACEHOLDER_FILL;
      if (levelOf(node) < anchorDepth) return ABOVE_ANCHOR_FILL;
      let anchor: SunNode = node;
      while ((levelOf(anchor) > anchorDepth || anchor.data.other) && anchor.parent) anchor = anchor.parent as SunNode;
      // Full path from the top ring down to this node (drops the synthetic root
      // and any "Other" grouping) so a subtree override (pathColorOf) can recolor
      // just its branch.
      const path = node.ancestors().reverse().slice(1).filter((n) => !n.data.other).map((n) => n.data.name).join(':');
      const base = (pathColorOf ? pathColorOf(path) : null) ?? colorOf(anchor.data.name);
      const c = d3.color(base);
      if (!c) return base;
      return c.brighter(Math.max(0, levelOf(node) - levelOf(anchor)) * 0.4).formatHex();
    };

    const tree = buildTree(rows, rootLabel);
    if (minShare) foldSmall(tree, subtotal(tree) * minShare);
    const root = d3
      .hierarchy<TreeDatum>(tree)
      .sum((d) => d.direct)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0)) as unknown as SunNode;

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

    // Inside a folded "Other" nothing is drawn until the reader zooms into it:
    // drawn in place, its members were the very slivers it exists to remove.
    let focus: SunNode = root;
    const foldedAway = (d: SunNode): boolean =>
      d.ancestors().slice(1).some((a) => a.data.other && !focus.ancestors().includes(a as SunNode));
    const arcShown = (d: SunNode, c: ArcCoords) => arcVisible(c) && !foldedAway(d);
    const labelShown = (d: SunNode, c: ArcCoords) => labelVisible(c) && !foldedAway(d);

    const tooltip = d3.select<HTMLDivElement, undefined>(tooltipRef.current);
    const showTip = (event: MouseEvent, d: SunNode) => {
      const named = d.ancestors().reverse().slice(1).filter((n) => !n.data.other || n === d);
      const context = named[0]?.data.context ?? (d.data.other ? d.children?.[0]?.data.context : undefined);
      const label = [...(context && !d.data.other ? [context] : []), ...named.map((n) => n.data.name)].join(' › ');
      tooltip
        .classed(TOOLTIP_CLASSES, true)
        .style('opacity', '1')
        .html(`<div class="font-medium">${label}</div><div>${(d.value ?? 0).toLocaleString()} ${valueLabel}</div>`)
        .style('left', `${event.clientX + 14}px`)
        .style('top', `${event.clientY - 12}px`);
    };
    const moveTip = (event: MouseEvent) => {
      tooltip.style('left', `${event.clientX + 14}px`).style('top', `${event.clientY - 12}px`);
    };
    const hideTip = () => tooltip.style('opacity', '0');

    // Only arcs and labels that are visible now or after the pending zoom get DOM
    // elements; one per node blocked the main thread for seconds on large trees.
    // Keyed by node so a zoom keeps the elements it reuses.
    const nodeKey = new Map<SunNode, number>(nodes.map((d, i) => [d, i]));
    const keyOf = (d: SunNode) => nodeKey.get(d) ?? -1;
    const pathGroup = g.append('g');
    const labelGroup = g
      .append('g')
      .attr('pointer-events', 'none')
      .attr('text-anchor', 'middle')
      .style('user-select', 'none');

    const joinPaths = () =>
      pathGroup
        .selectAll<SVGPathElement, SunNode>('path')
        .data(nodes.filter((d) => arcShown(d, d.current) || arcShown(d, d.target)), keyOf)
        .join((enter) =>
          enter
            .append('path')
            .attr('fill', (d) => fillOf(d))
            .attr('fill-opacity', (d) => (arcShown(d, d.current) ? (d.children ? 0.85 : 0.6) : 0))
            .attr('pointer-events', (d) => (arcShown(d, d.current) ? 'auto' : 'none'))
            .attr('d', (d) => drawArc(d.current))
            .style('cursor', 'pointer')
            .on('click', (_event, d) => clicked(d))
            .on('mouseover', (event, d) => showTip(event, d))
            .on('mousemove', (event) => moveTip(event))
            .on('mouseout', hideTip));

    const joinLabels = () =>
      labelGroup
        .selectAll<SVGTextElement, SunNode>('text')
        .data(nodes.filter((d) => labelShown(d, d.current) || labelShown(d, d.target)), keyOf)
        .join((enter) =>
          enter
            .append('text')
            .attr('dy', '0.35em')
            .style('font-size', '11px')
            .style('font-weight', '500')
            .style('paint-order', 'stroke')
            .style('stroke-linejoin', 'round')
            .style('stroke-width', '1.5px')
            .attr('fill', (d) => labelColors(fillOf(d)).fill)
            .style('stroke', (d) => labelColors(fillOf(d)).halo)
            .attr('opacity', (d) => (labelShown(d, d.current) ? 1 : 0))
            .attr('transform', (d) => labelTransform(d.current))
            .text((d) => (d.data.name.length > 18 ? `${d.data.name.slice(0, 17)}…` : d.data.name)));

    joinPaths();
    joinLabels();

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
        .text(d.depth === 0 ? rootLabel : (d.data.name.length > 22 ? `${d.data.name.slice(0, 21)}…` : d.data.name));
      centerText
        .append('tspan')
        .attr('x', 0)
        .attr('y', '1.1em')
        .style('font-size', '11px')
        .attr('fill', '#6b7280')
        .text(`${(d.value ?? 0).toLocaleString()} ${valueLabel}`);
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
      focus = target;
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
        // Not drawn before or after this zoom, so it has no element to animate
        // it: jump straight to the end state, as the transition would have.
        if (!arcVisible(n.current) && !arcVisible(n.target)) n.current = n.target;
      });
      const DURATION = 650;
      joinPaths()
        .transition()
        .duration(DURATION)
        .tween('data', (d) => {
          const i = d3.interpolate(d.current, d.target);
          return (time: number) => {
            d.current = i(time);
          };
        })
        .filter(function (this: SVGPathElement, d) {
          return Number(this.getAttribute('fill-opacity')) > 0 || arcShown(d, d.target);
        })
        .attr('fill-opacity', (d) => (arcShown(d, d.target) ? (d.children ? 0.85 : 0.6) : 0))
        .attr('pointer-events', (d) => (arcShown(d, d.target) ? 'auto' : 'none'))
        .attrTween('d', (d) => () => drawArc(d.current));
      joinLabels()
        .filter(function (this: SVGTextElement, d) {
          return Number(this.getAttribute('opacity')) > 0 || labelShown(d, d.target);
        })
        .transition()
        .duration(DURATION)
        .attr('opacity', (d) => (labelShown(d, d.target) ? 1 : 0))
        .attrTween('transform', (d) => () => labelTransform(d.current));
    }
  }, [rows, colorOf, pathColorOf, colorDepth, valueLabel, rootLabel, size, minShare]);

  return (
    <div ref={containerRef} className="relative flex w-full justify-center">
      <svg ref={svgRef} role="img" aria-label={`${rootLabel} sunburst`} />
      <div ref={tooltipRef} className={TOOLTIP_CLASSES} style={{ opacity: 0 }} />
    </div>
  );
});
