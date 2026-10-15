// Pure geometry and folding helpers for the property-search "Map" panel. The grid is a
// nested `histogram` agg: latitude/longitude are plain floats (no geo_point).
import { bucketFromGold, GOLD_BUCKET_ORDER, type GoldBucket } from '@/lib/utils/gold-buckets';

/** Allowed grid cell sizes in degrees, coarsest first, so a hostile `zoom` cannot ask
 *  for a 0.0001° world grid. */
export const GEO_INTERVALS = [5, 2, 1, 0.5, 0.25, 0.1, 0.05, 0.02, 0.01];

/** Legend slots for a `terms`-coloured field; the rest folds into "other". */
export const GEO_LEGEND_SIZE = 8;

export const GEO_OTHER_KEY = '__other__';

/** Above this many cells the response is coarsened one step (payload, `search.max_buckets`). */
export const GEO_MAX_CELLS = 20000;

export type GeoColorKind = 'gold' | 'terms';

export interface GeoColorField {
  id: string;
  label: string;
  /** 'gold' folds hundreds of raw paths into 9 palette buckets; 'terms' uses the field's top values. */
  kind: GeoColorKind;
}

/** Fields the map can colour by; each needs a legend a reader can hold and a palette. */
export const GEO_COLOR_FIELDS: GeoColorField[] = [
  { id: 'gold_ecosystem', label: 'GOLD ecosystem', kind: 'gold' },
  { id: 'product_category', label: 'Product category', kind: 'terms' },
  { id: 'sample_type', label: 'Sample type', kind: 'terms' },
  { id: 'tax_phylum', label: 'Taxonomic phylum', kind: 'terms' },
];

export function geoColorField(id: string | null | undefined): GeoColorField | null {
  if (!id) return null;
  return GEO_COLOR_FIELDS.find((f) => f.id === id) ?? null;
}

/** Leaflet zoom -> grid interval; below zoom 3, 5° keeps the cell count near a thousand. */
export function intervalForZoom(zoom: number): number {
  const z = Number.isFinite(zoom) ? Math.floor(zoom) : 0;
  if (z <= 2) return GEO_INTERVALS[0];
  return GEO_INTERVALS[Math.min(GEO_INTERVALS.length - 1, z - 2)];
}

export function coarserInterval(interval: number): number | null {
  const i = GEO_INTERVALS.indexOf(interval);
  return i > 0 ? GEO_INTERVALS[i - 1] : null;
}

// Histogram keys are floating point (30.000000000000004 on a 0.1° grid); round to 6 decimals.
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export interface CellBounds { latMin: number; latMax: number; lonMin: number; lonMax: number }

/** A histogram bucket key is the cell's LOWER edge; this recovers the full box. */
export function cellBounds(lat: number, lon: number, interval: number): CellBounds {
  return {
    latMin: round6(lat),
    latMax: round6(lat + interval),
    lonMin: round6(lon),
    lonMax: round6(lon + interval),
  };
}

export function cellCenter(lat: number, lon: number, interval: number): [number, number] {
  return [round6(lat + interval / 2), round6(lon + interval / 2)];
}

/** The GOLD vocabulary grouped into the 9 display buckets, so the colour agg can use exact
 *  `terms` lists (faster than `prefix`). "unknown" is the other-bucket. */
export function goldTermLists(paths: string[]): Partial<Record<GoldBucket, string[]>> {
  const out: Partial<Record<GoldBucket, string[]>> = {};
  for (const path of paths) {
    const bucket = bucketFromGold(path);
    if (bucket === 'unknown') continue;
    (out[bucket] ??= []).push(path);
  }
  return out;
}

export function goldLegendKeys(): string[] {
  return [...GOLD_BUCKET_ORDER];
}

export interface FoldedCell {
  /** Index into legendKeys of the cell's most common value, or -1 when uncoloured. */
  dom: number;
  /** Sparse [legendIndex, count] pairs — most cells touch only one or two slots. */
  pairs: [number, number][];
}

/**
 * Fold one cell's per-value counts onto the legend. Values outside the legend and docs
 * with the field unset land in the "other" slot, which callers append to the legend.
 */
export function foldCell(
  total: number,
  entries: Iterable<[string, number]>,
  legendIndex: Map<string, number>,
  otherIndex: number,
): FoldedCell {
  const byIndex = new Map<number, number>();
  let counted = 0;
  for (const [key, count] of entries) {
    if (count <= 0) continue;
    const idx = legendIndex.get(key) ?? otherIndex;
    byIndex.set(idx, (byIndex.get(idx) ?? 0) + count);
    counted += count;
  }
  const remainder = total - counted;
  if (remainder > 0) byIndex.set(otherIndex, (byIndex.get(otherIndex) ?? 0) + remainder);

  const pairs = [...byIndex.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]) as [number, number][];
  return { dom: pairs.length ? pairs[0][0] : -1, pairs };
}

/** Clamp a viewport to valid WGS84 ranges; a view panned past a pole or wrapped is
 *  "no constraint" on that axis rather than a box matching nothing. */
export function normalizeBbox(bbox: Partial<CellBounds> | null | undefined): Partial<CellBounds> | null {
  if (!bbox) return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const latMin = num(bbox.latMin);
  const latMax = num(bbox.latMax);
  const lonMin = num(bbox.lonMin);
  const lonMax = num(bbox.lonMax);

  const out: Partial<CellBounds> = {};
  if (latMin !== null && latMax !== null && latMax > latMin) {
    out.latMin = Math.max(-90, latMin);
    out.latMax = Math.min(90, latMax);
  }
  // A view wider than the globe cannot be one range clause; drop the longitude constraint.
  if (lonMin !== null && lonMax !== null && lonMax > lonMin && lonMax - lonMin < 360 && lonMin >= -180 && lonMax <= 180) {
    out.lonMin = lonMin;
    out.lonMax = lonMax;
  }
  return Object.keys(out).length ? out : null;
}
