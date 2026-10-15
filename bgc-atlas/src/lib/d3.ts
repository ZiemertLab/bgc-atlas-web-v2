// Curated d3 re-exports: d3's main package has `sideEffects` unset, so importing it pulls the
// full bundle. Add new APIs here and keep the surface small.

export { extent, max, mean, median, range, rollup, sum, bin, histogram } from 'd3-array';
export { axisBottom, axisLeft } from 'd3-axis';
export { drag } from 'd3-drag';
export {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
} from 'd3-force';
export type { SimulationNodeDatum } from 'd3-force';
export { format } from 'd3-format';
export { hierarchy, partition } from 'd3-hierarchy';
export type { HierarchyNode, HierarchyRectangularNode } from 'd3-hierarchy';
export { interpolate } from 'd3-interpolate';
export { color } from 'd3-color';
export { scaleBand, scaleLinear, scaleLog, scaleOrdinal, scaleSequential } from 'd3-scale';
export {
  interpolateBlues,
  schemeSet1,
  schemeSet2,
  schemeSet3,
} from 'd3-scale-chromatic';
export { select, selectAll } from 'd3-selection';
export { arc, pie, stack, line } from 'd3-shape';
export type { PieArcDatum, Series, SeriesPoint } from 'd3-shape';
export { zoom, zoomIdentity } from 'd3-zoom';
