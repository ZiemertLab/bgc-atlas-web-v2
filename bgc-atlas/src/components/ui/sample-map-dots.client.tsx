"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";

import { useMapSamples, type UseMapSamplesParams, type FrontendMapSample } from "@/lib/hooks/use-map-samples";
import { withBase } from "@/lib/basePath";
import { BASEMAP_ATTRIBUTION, BASEMAP_SUBDOMAINS, BASEMAP_URL } from "@/lib/basemap";
import { MapAreaSelect, type AreaBounds } from "@/components/ui/map-area-select.client";
import { MAP_BLOCK_CLASS, MAP_WORLD_WIDTH } from "@/components/ui/map-layout";
import { MapPlaceSearch } from "@/components/ui/map-place-search.client";
import {
  bucketFromGold,
  bucketStroke,
  GOLD_BUCKET_COLOR,
  GOLD_BUCKET_LABEL,
  GOLD_BUCKET_ORDER,
  type GoldBucket,
} from "@/lib/utils/gold-buckets";

// One world copy is 256·2^MIN_ZOOM px; the card is capped at that width (see map-layout)
// rather than zooming in, which would crop the poles at a fixed height.
const MIN_ZOOM = 2;
/** Full Web Mercator extent — panning is clamped to a single world copy. */
const WORLD_BOUNDS: [[number, number], [number, number]] = [
  [-85.05, -180],
  [85.05, 180],
];

// Coordinates are often rounded to the sampling site, so a fit never zooms past region level.
const FIT_MAX_ZOOM = 5;

/** 1024px map + gap-8 + a 300px rail — see `DotsMapProps.railAt`. */
const RAIL_MIN_BLOCK_WIDTH = 1356;

/** Narrowest map that shows the location panel inside its frame; narrower maps put it below. */
const OVERLAY_MIN_WIDTH = 640;

/** The overlay's top never rises into the corner controls (zoom on the left,
 *  place search and area select on the right) ... */
const PANEL_TOP_INSET = 112;
/** ... nor does its bottom reach the attribution. */
const PANEL_BOTTOM_INSET = 28;

interface DotsMapProps {
  height?: number;
  params?: UseMapSamplesParams;
  /** Pre-fetched samples to plot; skips both queries. Must carry `goldEcosystemPath`. */
  samples?: FrontendMapSample[];
  /** Open on the plotted points' bounds. Defaults to true when `samples` are supplied. */
  fitToData?: boolean;
  /**
   * Manifest pointing at a pre-generated snapshot (scripts/generate-map-snapshot.ts), fetched
   * instead of /api/samples/map. The data file is content-hashed so it can be cached forever.
   */
  staticManifestUrl?: string;
  /** The area control deep-links to /samples and /bgcs, so it is off on the genome-collections map. */
  showAreaSelect?: boolean;
  /** Replaces the block's default centred sizing, e.g. "w-full" inside a page column. */
  blockClassName?: string;
  /** Block width at which the legend becomes a right-hand rail. Measured on the block, not the
   *  viewport: the same viewport can hand this component a page, a column or a panel. */
  railAt?: number;
}

type SnapshotManifest = {
  version: string;
  url: string;
  total: number;
  missingGeolocation: number;
  generatedAt?: string;
};

type SnapshotSampleRecord = {
  id: string;
  externalId: string | null;
  name: string | null;
  latitude: number;
  longitude: number;
  goldEcosystemPath: string | null;
  bgcCount: number;
};

// One record per distinct coordinate (the map-genomes snapshot ships ~23k clusters, not ~350k
// points); no per-sample detail.
type AggregatedClusterRecord = {
  latitude: number;
  longitude: number;
  count: number;
  totalBgc: number;
  buckets: Partial<Record<GoldBucket, number>>;
};

type SnapshotPayload = {
  total: number;
  missingGeolocation: number;
  aggregated?: boolean;
  data: SnapshotSampleRecord[] | AggregatedClusterRecord[];
};

const MIN_R = 2.5;
const MAX_R = 9;
const COORD_PRECISION = 4; // ~11 m
const EMPTY_BUCKETS: Record<GoldBucket, number> = {
  "host-animal": 0,
  "host-plant": 0,
  marine: 0,
  freshwater: 0,
  "soil-terrestrial": 0,
  "other-environmental": 0,
  engineered: 0,
  mixed: 0,
  unknown: 0,
};

// Stable empty reference: a fresh `[]` would re-run the expensive clustering memo every render.
const EMPTY_AGGREGATED_RECORDS: AggregatedClusterRecord[] = [];

interface ClusterSample {
  id: string;
  name: string | null;
  externalId: string | null;
  bgcCount: number;
  bucket: GoldBucket;
  goldEcosystemPath: string | null;
}

interface Cluster {
  key: string;
  lat: number;
  lng: number;
  count: number;
  totalBgc: number;
  dominantBucket: GoldBucket;
  buckets: Record<GoldBucket, number>;
  samples: ClusterSample[];
}

function radiusForBgc(bgcCount: number, logMax: number): number {
  if (logMax <= 0) return MIN_R;
  const t = Math.log1p(Math.max(0, bgcCount)) / logMax;
  return MIN_R + Math.min(1, t) * (MAX_R - MIN_R);
}

function pickDominant(buckets: Record<GoldBucket, number>): GoldBucket {
  let best: GoldBucket = "unknown";
  let bestN = -1;
  for (const b of GOLD_BUCKET_ORDER) {
    if (buckets[b] > bestN) {
      bestN = buckets[b];
      best = b;
    }
  }
  return best;
}

export function DotsMap({ height = 800, params, staticManifestUrl, samples: providedSamples, showAreaSelect = true, fitToData, blockClassName, railAt = RAIL_MIN_BLOCK_WIDTH }: DotsMapProps) {
  const hasProvided = Array.isArray(providedSamples);
  // A map handed a subset opens on it; browse and snapshot maps stay global.
  const fitsToData = fitToData ?? hasProvided;
  const useStatic = !hasProvided && Boolean(staticManifestUrl);

  const dynamicQuery = useMapSamples({
    sourceType: "metagenome",
    ...params,
    enabled: !useStatic && !hasProvided,
  });

  // Static path: a small revalidating manifest, then the content-hashed (immutable) data file.
  const staticQuery = useQuery({
    queryKey: ["map-snapshot", staticManifestUrl],
    enabled: useStatic,
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async ({ signal }) => {
      const manifestRes = await fetch(withBase(staticManifestUrl!), { signal, cache: "no-cache" });
      if (!manifestRes.ok) throw new Error(`Map snapshot manifest fetch failed: ${manifestRes.status}`);
      const manifest = (await manifestRes.json()) as SnapshotManifest;
      const dataRes = await fetch(withBase(manifest.url), { signal });
      if (!dataRes.ok) throw new Error(`Map snapshot data fetch failed: ${dataRes.status}`);
      return (await dataRes.json()) as SnapshotPayload;
    },
  });

  const isLoading = hasProvided ? false : useStatic ? staticQuery.isLoading : dynamicQuery.isLoading;

  // A failed fetch must not render as an empty map, indistinguishable from a filter matching
  // nothing (e.g. a 400 for a condition /api/samples/map cannot honour).
  const loadError = hasProvided
    ? null
    : ((useStatic ? staticQuery.error : dynamicQuery.error) as Error | null) ?? null;

  const staticPayload = useStatic ? staticQuery.data : undefined;
  const isAggregated = Boolean(staticPayload?.aggregated);

  const missingGeolocation = hasProvided
    ? 0
    : useStatic
      ? staticPayload?.missingGeolocation ?? 0
      : dynamicQuery.data?.missingGeolocation ?? 0;
  const router = useRouter();
  const [activeBuckets, setActiveBuckets] = useState<Set<GoldBucket>>(
    () => new Set()
  );
  // Width of this block, not the window. Measured before paint so a wide block never flashes
  // its stacked layout.
  const blockRef = useRef<HTMLDivElement>(null);
  const [railed, setRailed] = useState(false);
  const [blockWidth, setBlockWidth] = useState(0);
  useLayoutEffect(() => {
    const el = blockRef.current;
    if (!el) return;
    const measure = () => {
      const width = el.getBoundingClientRect().width;
      setRailed(width >= railAt);
      setBlockWidth(width);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [railAt]);

  const [selectedClusterKey, setSelectedClusterKey] = useState<string | null>(
    null
  );
  // Below the map the panel lands off-screen on the homepage, so a wide-enough map shows it
  // inside the frame, on the side away from the clicked dot.
  const overlayPanel = !railed && blockWidth >= OVERLAY_MIN_WIDTH;
  const [panelSide, setPanelSide] = useState<"left" | "right">("right");
  // Level with the clicked dot: a panel docked at the bottom falls below the fold on laptops.
  const [panelTop, setPanelTop] = useState(PANEL_TOP_INSET);
  const mapFrameRef = useRef<HTMLDivElement>(null);
  const belowPanelRef = useRef<HTMLDivElement>(null);
  const closePanel = useCallback(() => setSelectedClusterKey(null), []);
  useEffect(() => {
    if (!selectedClusterKey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedClusterKey(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedClusterKey]);
  useEffect(() => {
    if (!selectedClusterKey || railed || overlayPanel) return;
    belowPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedClusterKey, railed, overlayPanel]);

  // The source conditional lives inside the memo; outside it, a fresh array each render would
  // re-run the memo.
  const rawDerived = useMemo(() => {
    const rawSamples: FrontendMapSample[] = hasProvided
      ? providedSamples!
      : useStatic
        ? (isAggregated ? [] : ((staticPayload?.data ?? []) as unknown as FrontendMapSample[]))
        : (dynamicQuery.data?.data ?? []);

    const valid = rawSamples
      .filter(
        (s) =>
          typeof s.latitude === "number" &&
          typeof s.longitude === "number" &&
          !Number.isNaN(s.latitude) &&
          !Number.isNaN(s.longitude)
      )
      .map((s) => ({ ...s, bucket: bucketFromGold(s.goldEcosystemPath) }));

    const counts: Record<GoldBucket, number> = { ...EMPTY_BUCKETS };
    valid.forEach((s) => {
      counts[s.bucket] += 1;
    });

    const maxBgc = valid.reduce((m, s) => Math.max(m, s.bgcCount ?? 0), 0);
    return { allValid: valid, bucketCounts: counts, logMax: Math.log1p(maxBgc) };
  }, [hasProvided, providedSamples, useStatic, isAggregated, staticPayload, dynamicQuery.data]);

  const aggDerived = useMemo(() => {
    const aggregatedRecords: AggregatedClusterRecord[] = isAggregated
      ? ((staticPayload?.data ?? []) as AggregatedClusterRecord[])
      : EMPTY_AGGREGATED_RECORDS;

    const clusters: Cluster[] = [];
    const counts: Record<GoldBucket, number> = { ...EMPTY_BUCKETS };
    let maxTotalBgc = 0;
    for (const r of aggregatedRecords) {
      if (
        typeof r.latitude !== "number" ||
        typeof r.longitude !== "number" ||
        Number.isNaN(r.latitude) ||
        Number.isNaN(r.longitude)
      ) {
        continue;
      }
      const buckets: Record<GoldBucket, number> = { ...EMPTY_BUCKETS };
      for (const b of GOLD_BUCKET_ORDER) {
        const n = r.buckets?.[b] ?? 0;
        buckets[b] = n;
        counts[b] += n;
      }
      maxTotalBgc = Math.max(maxTotalBgc, r.totalBgc ?? 0);
      clusters.push({
        key: `${r.latitude}|${r.longitude}`,
        lat: r.latitude,
        lng: r.longitude,
        count: r.count ?? 0,
        totalBgc: r.totalBgc ?? 0,
        dominantBucket: pickDominant(buckets),
        buckets,
        samples: [], // aggregated: no per-sample detail
      });
    }
    return { clusters, bucketCounts: counts, logMax: Math.log1p(maxTotalBgc) };
  }, [isAggregated, staticPayload]);

  const allValid = rawDerived.allValid;
  const bucketCounts = isAggregated ? aggDerived.bucketCounts : rawDerived.bucketCounts;
  const logMax = isAggregated ? aggDerived.logMax : rawDerived.logMax;

  const clusters = useMemo<Cluster[]>(() => {
    if (isAggregated) {
      // Aggregated mode filters by a cluster's dominant bucket; per-sample buckets aren't shipped.
      const all = aggDerived.clusters;
      const filtered =
        activeBuckets.size > 0
          ? all.filter((c) => activeBuckets.has(c.dominantBucket))
          : all;
      return [...filtered].sort((a, b) => a.totalBgc - b.totalBgc);
    }

    const filtered =
      activeBuckets.size > 0
        ? allValid.filter((s) => activeBuckets.has(s.bucket))
        : allValid;

    const groups = new Map<string, Cluster>();
    for (const s of filtered) {
      const lat = Number((s.latitude as number).toFixed(COORD_PRECISION));
      const lng = Number((s.longitude as number).toFixed(COORD_PRECISION));
      const key = `${lat}|${lng}`;
      let c = groups.get(key);
      if (!c) {
        c = {
          key,
          lat,
          lng,
          count: 0,
          totalBgc: 0,
          dominantBucket: s.bucket,
          buckets: { ...EMPTY_BUCKETS },
          samples: [],
        };
        groups.set(key, c);
      }
      c.count += 1;
      c.totalBgc += s.bgcCount ?? 0;
      c.buckets[s.bucket] += 1;
      c.samples.push({
        id: s.id,
        name: s.name,
        externalId: s.externalId,
        bgcCount: s.bgcCount ?? 0,
        bucket: s.bucket,
        goldEcosystemPath: s.goldEcosystemPath ?? null,
      });
    }

    const arr = Array.from(groups.values());
    arr.forEach((c) => {
      c.dominantBucket = pickDominant(c.buckets);
    });
    arr.sort((a, b) => a.totalBgc - b.totalBgc);
    return arr;
  }, [isAggregated, aggDerived, allValid, activeBuckets]);

  const selectedCluster = useMemo(
    () =>
      selectedClusterKey
        ? clusters.find((c) => c.key === selectedClusterKey) ?? null
        : null,
    [selectedClusterKey, clusters]
  );

  // The API's `goldBucket` is single-valued, so it is carried only when one bucket is active.
  const carriedBucket = activeBuckets.size === 1 ? Array.from(activeBuckets)[0] : null;

  const countInBounds = useCallback((b: AreaBounds) => {
    let samplesInBounds = 0;
    let bgcs = 0;
    if (isAggregated) {
      // Sum whole clusters — per-sample coords aren't available.
      for (const c of aggDerived.clusters) {
        if (activeBuckets.size > 0 && !activeBuckets.has(c.dominantBucket)) continue;
        if (c.lat >= b.latMin && c.lat <= b.latMax && c.lng >= b.lonMin && c.lng <= b.lonMax) {
          samplesInBounds += c.count;
          bgcs += c.totalBgc;
        }
      }
      return { samples: samplesInBounds, bgcs };
    }
    for (const s of allValid) {
      if (activeBuckets.size > 0 && !activeBuckets.has(s.bucket)) continue;
      const lat = s.latitude as number;
      const lng = s.longitude as number;
      if (lat >= b.latMin && lat <= b.latMax && lng >= b.lonMin && lng <= b.lonMax) {
        samplesInBounds += 1;
        bgcs += s.bgcCount ?? 0;
      }
    }
    return { samples: samplesInBounds, bgcs };
  }, [isAggregated, aggDerived, allValid, activeBuckets]);

  const buildQuery = useCallback((b: AreaBounds) => {
    const p = new URLSearchParams({
      latMin: b.latMin.toFixed(5),
      latMax: b.latMax.toFixed(5),
      lonMin: b.lonMin.toFixed(5),
      lonMax: b.lonMax.toFixed(5),
    });
    if (carriedBucket) p.set("goldBucket", carriedBucket);
    return p.toString();
  }, [carriedBucket]);

  // router.push already prepends basePath; withBase() would double it.
  const onViewSamples = useCallback((b: AreaBounds) => {
    router.push(`/samples?${buildQuery(b)}`);
  }, [router, buildQuery]);

  const onViewBgcs = useCallback((b: AreaBounds) => {
    router.push(`/bgcs?${buildQuery(b)}`);
  }, [router, buildQuery]);

  const handleBucketClick = (b: GoldBucket) => {
    setActiveBuckets((prev) => {
      const next = new Set(prev);
      if (next.has(b)) next.delete(b);
      else next.add(b);
      return next;
    });
    setSelectedClusterKey(null);
  };

  const handleClearFilter = () => {
    setActiveBuckets(new Set());
    setSelectedClusterKey(null);
  };

  return (
    // Below 2xl the boxes stack as one card; above it they sit side by side, top-aligned so a
    // short legend is not stretched to the map's height.
    <div
      ref={blockRef}
      data-railed={railed}
      className={`group/mapblock ${blockClassName ?? MAP_BLOCK_CLASS} mx-auto flex flex-col data-[railed=true]:flex-row data-[railed=true]:items-start data-[railed=true]:gap-8`}
    >
      <div
        className="isolate mx-auto w-full border border-border bg-card group-data-[railed=true]/mapblock:mx-0 group-data-[railed=true]/mapblock:min-w-0 group-data-[railed=true]/mapblock:flex-1"
        style={{ maxWidth: MAP_WORLD_WIDTH }}
      >
        {/* At most 480px on a phone: Leaflet swallows touch-drag, so a taller map traps scrolling. */}
        <div
          ref={mapFrameRef}
          className="relative h-[min(480px,var(--map-height))] sm:h-[var(--map-height)]"
          style={{ "--map-height": `${height}px` } as CSSProperties}
        >
          {isLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Loading sample positions…
            </div>
          ) : loadError ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm">
              <p className="font-semibold text-destructive">Failed to load sample positions</p>
              <p className="max-w-prose text-muted-foreground">{loadError.message}</p>
            </div>
          ) : (
            <MapContainer
              center={[20, 0]}
              zoom={MIN_ZOOM}
              minZoom={MIN_ZOOM}
              maxZoom={13}
              maxBounds={WORLD_BOUNDS}
              maxBoundsViscosity={1}
              style={{
                height: "100%",
                width: "100%",
                background: "var(--card)",
              }}
            >
              <TileLayer
                noWrap
                url={BASEMAP_URL}
                subdomains={BASEMAP_SUBDOMAINS}
                attribution={BASEMAP_ATTRIBUTION}
              />
              {/* Area select first so the place-search dropdown paints above it: same z-index, DOM order wins. */}
              {showAreaSelect ? (
                <MapAreaSelect
                  countInBounds={countInBounds}
                  onViewSamples={onViewSamples}
                  onViewBgcs={onViewBgcs}
                  offsetTop
                />
              ) : null}
              <MapPlaceSearch />
              {selectedCluster ? <CloseOnMapClick onClose={closePanel} /> : null}
            {fitsToData ? <FitToClusters clusters={clusters} /> : null}
              {clusters.map((c) => {
                const radius = radiusForBgc(c.totalBgc, logMax);
                const color = GOLD_BUCKET_COLOR[c.dominantBucket];
                const stroke = bucketStroke(c.dominantBucket);
                const isSelected = c.key === selectedClusterKey;
                return (
                  <CircleMarker
                    key={c.key}
                    center={[c.lat, c.lng]}
                    radius={isSelected ? radius + 1.5 : radius}
                    pathOptions={{
                      color: isSelected ? "#000000" : stroke.color,
                      weight: isSelected ? 1.5 : stroke.weight,
                      fillColor: color,
                      fillOpacity: 0.78,
                    }}
                    bubblingMouseEvents={false}
                    eventHandlers={{
                      click: (e) => {
                        // Dock the panel on the half of the map the dot is NOT in.
                        const frameWidth = mapFrameRef.current?.clientWidth ?? 0;
                        const frameHeight = mapFrameRef.current?.clientHeight ?? 0;
                        setPanelSide(e.containerPoint.x > frameWidth / 2 ? "left" : "right");
                        // Clear of the corner controls; low enough that at 60% max height the
                        // panel still ends above the attribution.
                        const lowest = Math.max(PANEL_TOP_INSET, frameHeight * 0.4 - PANEL_BOTTOM_INSET);
                        setPanelTop(Math.min(Math.max(e.containerPoint.y - 80, PANEL_TOP_INSET), lowest));
                        setSelectedClusterKey(c.key);
                      },
                    }}
                  >
                    <Tooltip direction="top" offset={[0, -2]}>
                      <ClusterTooltip cluster={c} />
                    </Tooltip>
                  </CircleMarker>
                );
              })}
            </MapContainer>
          )}
          {overlayPanel && selectedCluster && !isLoading && !loadError ? (
            // Above Leaflet panes (700) and below the controls (1000), so the place-search
            // dropdown paints over it.
            <div
              className={`absolute z-[900] flex max-h-[60%] w-[340px] max-w-[calc(100%-1.5rem)] flex-col border border-border bg-card shadow-[0_4px_16px_-8px_rgba(0,0,0,0.25)] ${panelSide === "left" ? "left-3" : "right-3"}`}
              style={{ top: panelTop }}
              role="dialog"
              aria-label="Samples at this location"
            >
              <SelectedClusterPanel cluster={selectedCluster} onClose={closePanel} variant="overlay" />
            </div>
          ) : null}
        </div>
      </div>
      {/* Suppressed on a failed fetch, where every figure would be a misleading zero. min-w-0 lets
          the rail give way inside a CollapsibleSection. */}
      {loadError ? null : (
      <div
        className="mx-auto w-full border-x border-b border-border bg-card group-data-[railed=true]/mapblock:mx-0 group-data-[railed=true]/mapblock:min-w-0 group-data-[railed=true]/mapblock:max-w-[380px] group-data-[railed=true]/mapblock:flex-1 group-data-[railed=true]/mapblock:border-t"
        style={railed ? undefined : { maxWidth: MAP_WORLD_WIDTH }}
      >
        <DotsLegend
        bucketCounts={bucketCounts}
        logMax={logMax}
        missingGeolocation={missingGeolocation}
        activeBuckets={activeBuckets}
        onBucketClick={handleBucketClick}
        onClearFilter={handleClearFilter}
        aggregated={isAggregated}
      />
      {selectedCluster && !overlayPanel ? (
        <div ref={belowPanelRef}>
          <SelectedClusterPanel
            cluster={selectedCluster}
            onClose={closePanel}
            variant={railed ? "rail" : "below"}
          />
        </div>
      ) : null}
      </div>
      )}
    </div>
  );
}

// Fits once per set of coordinates, so it never fights the reader's own panning.
function FitToClusters({ clusters }: { clusters: Cluster[] }) {
  const map = useMap();
  const fittedKey = useRef<string | null>(null);

  useEffect(() => {
    if (clusters.length === 0) return;
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    for (const c of clusters) {
      if (c.lat < minLat) minLat = c.lat;
      if (c.lat > maxLat) maxLat = c.lat;
      if (c.lng < minLng) minLng = c.lng;
      if (c.lng > maxLng) maxLng = c.lng;
    }
    const key = `${minLat},${minLng},${maxLat},${maxLng}`;
    if (fittedKey.current === key) return;
    fittedKey.current = key;
    map.fitBounds(
      [
        [minLat, minLng],
        [maxLat, maxLng],
      ],
      { padding: [28, 28], maxZoom: FIT_MAX_ZOOM }
    );
  }, [clusters, map]);

  return null;
}

function ClusterTooltip({ cluster }: { cluster: Cluster }) {
  if (cluster.samples.length === 0) {
    return (
      <div className="text-xs">
        <div className="font-medium">
          {cluster.count.toLocaleString()}{" "}
          {cluster.count === 1 ? "genome" : "genomes"} at this location
        </div>
        <div className="text-muted-foreground">
          <span
            className="mr-1 inline-block size-2 align-middle"
            style={{ background: GOLD_BUCKET_COLOR[cluster.dominantBucket] }}
          />
          {GOLD_BUCKET_LABEL[cluster.dominantBucket]}
        </div>
        <div className="font-mono tabular-nums text-muted-foreground">
          {cluster.totalBgc.toLocaleString()} BGCs · {cluster.lat.toFixed(3)},{" "}
          {cluster.lng.toFixed(3)} · click to inspect
        </div>
      </div>
    );
  }

  if (cluster.count === 1) {
    const s = cluster.samples[0];
    const color = GOLD_BUCKET_COLOR[s.bucket];
    return (
      <div className="text-xs">
        <div className="font-medium">{s.name ?? s.externalId ?? s.id}</div>
        <div className="text-muted-foreground">
          <span
            className="mr-1 inline-block size-2 align-middle"
            style={{ background: color }}
          />
          {GOLD_BUCKET_LABEL[s.bucket]}
        </div>
        {s.goldEcosystemPath ? (
          <div className="font-mono text-[10.5px] opacity-70">
            {s.goldEcosystemPath}
          </div>
        ) : null}
        <div className="font-mono tabular-nums text-muted-foreground">
          {s.bgcCount.toLocaleString()} BGCs · click to inspect
        </div>
      </div>
    );
  }

  const visible = cluster.samples.slice(0, 5);
  const overflow = cluster.samples.length - visible.length;

  return (
    <div className="text-xs">
      <div className="font-medium">
        {cluster.count.toLocaleString()} samples at this location
      </div>
      <div className="font-mono tabular-nums text-muted-foreground">
        {cluster.totalBgc.toLocaleString()} BGCs total ·{" "}
        {cluster.lat.toFixed(3)}, {cluster.lng.toFixed(3)}
      </div>
      <ul className="mt-1 space-y-0.5">
        {visible.map((s) => (
          <li key={s.id} className="flex items-center gap-1.5">
            <span
              className="inline-block size-2 shrink-0"
              style={{ background: GOLD_BUCKET_COLOR[s.bucket] }}
              aria-hidden
            />
            <span className="truncate">
              {s.name ?? s.externalId ?? s.id}
            </span>
            <span className="ml-auto font-mono tabular-nums text-muted-foreground">
              {s.bgcCount.toLocaleString()}
            </span>
          </li>
        ))}
        {overflow > 0 ? (
          <li className="text-[10.5px] uppercase tracking-wider opacity-70">
            + {overflow.toLocaleString()} more
          </li>
        ) : null}
      </ul>
      <div className="mt-1 text-[10.5px] uppercase tracking-wider opacity-70">
        click to inspect
      </div>
    </div>
  );
}

function DotsLegend({
  bucketCounts,
  logMax,
  missingGeolocation,
  activeBuckets,
  onBucketClick,
  onClearFilter,
  aggregated = false,
}: {
  bucketCounts: Record<GoldBucket, number>;
  logMax: number;
  missingGeolocation: number;
  activeBuckets: Set<GoldBucket>;
  onBucketClick: (b: GoldBucket) => void;
  onClearFilter: () => void;
  aggregated?: boolean;
}) {
  const observedMax = Math.round(Math.expm1(logMax));
  const sizeStops = (() => {
    const stops = [1, 10, 100];
    if (observedMax > 250) stops.push(observedMax);
    return stops;
  })();

  return (
    <div className="grid grid-cols-1 gap-3 border-t border-border bg-muted/15 px-4 py-3 sm:grid-cols-2 sm:gap-6 group-data-[railed=true]/mapblock:grid-cols-1 group-data-[railed=true]/mapblock:gap-5 group-data-[railed=true]/mapblock:border-t-0">
      <div>
        <div className="section-label mb-2 flex items-baseline justify-between gap-2">
          <span>Environment</span>
          {activeBuckets.size > 0 ? (
            <button
              type="button"
              onClick={onClearFilter}
              className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground underline-offset-2 hover:underline"
            >
              Clear filter ({activeBuckets.size})
            </button>
          ) : null}
        </div>
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11.5px] text-muted-foreground group-data-[railed=true]/mapblock:flex-col group-data-[railed=true]/mapblock:items-stretch group-data-[railed=true]/mapblock:gap-y-0.5">
          {GOLD_BUCKET_ORDER.map((bucket) => {
            const count = bucketCounts[bucket];
            if (count === 0) return null;
            const isActive = activeBuckets.has(bucket);
            const dimmed = activeBuckets.size > 0 && !isActive;
            const stroke = bucketStroke(bucket);
            return (
              <li key={bucket}>
                <button
                  type="button"
                  onClick={() => onBucketClick(bucket)}
                  aria-pressed={isActive}
                  className={[
                    "flex w-full items-center gap-1.5 rounded-sm px-1.5 py-0.5 transition",
                    isActive
                      ? "bg-foreground/5 ring-1 ring-foreground/20"
                      : "hover:bg-muted",
                    dimmed ? "opacity-40" : "",
                  ].join(" ")}
                >
                  <span
                    className="inline-block size-2.5 rounded-full"
                    style={{
                      background: GOLD_BUCKET_COLOR[bucket],
                      boxShadow: `inset 0 0 0 ${stroke.weight}px ${stroke.color}`,
                    }}
                    aria-hidden
                  />
                  <span className="text-foreground">
                    {GOLD_BUCKET_LABEL[bucket]}
                  </span>
                  <span className="font-mono tabular-nums group-data-[railed=true]/mapblock:ml-auto">
                    {count.toLocaleString()}
                  </span>
                </button>
              </li>
            );
          })}
          {missingGeolocation > 0 ? (
            <li className="ml-1 flex items-center gap-1.5 border-l border-border pl-3 text-muted-foreground group-data-[railed=true]/mapblock:ml-0 group-data-[railed=true]/mapblock:mt-2 group-data-[railed=true]/mapblock:border-l-0 group-data-[railed=true]/mapblock:border-t group-data-[railed=true]/mapblock:px-1.5 group-data-[railed=true]/mapblock:pl-1.5 group-data-[railed=true]/mapblock:pt-2">
              <span className="text-[10.5px] uppercase tracking-wider opacity-70">
                Missing geolocation
              </span>
              <span className="font-mono tabular-nums group-data-[railed=true]/mapblock:ml-auto">
                {missingGeolocation.toLocaleString()}
              </span>
            </li>
          ) : null}
        </ul>
      </div>
      <div>
        <div className="section-label mb-2">{aggregated ? "BGCs per location" : "BGCs per sample"}</div>
        <ul className="flex flex-wrap items-end gap-x-5 gap-y-1.5 text-[11.5px] text-muted-foreground">
          {sizeStops.map((stop) => {
            const r = radiusForBgc(stop, logMax);
            const px = r * 2;
            return (
              <li key={stop} className="flex items-center gap-1.5">
                <span
                  className="inline-block rounded-full"
                  style={{
                    width: `${px}px`,
                    height: `${px}px`,
                    background: "var(--foreground)",
                    opacity: 0.55,
                  }}
                  aria-hidden
                />
                <span className="font-mono tabular-nums">
                  {stop.toLocaleString()}
                </span>
              </li>
            );
          })}
          <li className="text-[10.5px] uppercase tracking-wider opacity-70">
            log scale
          </li>
        </ul>
      </div>
    </div>
  );
}

/** Dots set bubblingMouseEvents false, so only clicks on the map itself dismiss the panel. */
function CloseOnMapClick({ onClose }: { onClose: () => void }) {
  useMapEvents({ click: onClose });
  return null;
}

// `variant`: below the map, in the rail, or floating inside the frame (scrolls inside it).
function SelectedClusterPanel({
  cluster,
  onClose,
  variant,
}: {
  cluster: Cluster;
  onClose: () => void;
  variant: "below" | "rail" | "overlay";
}) {
  const compact = variant !== "below";
  const overlay = variant === "overlay";
  if (cluster.samples.length === 0) {
    return (
      <div className={`bg-card px-4 py-3 ${overlay ? "" : "border-t border-border"}`}>
        <div className="mb-1 flex items-baseline justify-between gap-3">
          <div>
            <div className="section-label mb-0.5">Location</div>
            <div className="font-mono text-[11.5px] tabular-nums text-muted-foreground">
              {cluster.lat.toFixed(4)}, {cluster.lng.toFixed(4)} ·{" "}
              {cluster.count.toLocaleString()}{" "}
              {cluster.count === 1 ? "genome" : "genomes"} ·{" "}
              {cluster.totalBgc.toLocaleString()} BGCs ·{" "}
              {GOLD_BUCKET_LABEL[cluster.dominantBucket]}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground underline-offset-2 hover:underline"
            aria-label="Close location panel"
          >
            Close
          </button>
        </div>
        <p className="text-[12px] text-muted-foreground">
          Individual genomes aren’t listed on the aggregated map. Filter the
          table (search, biome, data source, …) to inspect the genomes here.
        </p>
      </div>
    );
  }

  return (
    <div className={`bg-card px-4 py-3 ${overlay ? "flex min-h-0 flex-1 flex-col" : "border-t border-border"}`}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <div>
          <div className="section-label mb-0.5">Samples at location</div>
          <div className="font-mono text-[11.5px] tabular-nums text-muted-foreground">
            {cluster.lat.toFixed(4)}, {cluster.lng.toFixed(4)} ·{" "}
            {cluster.count.toLocaleString()}{" "}
            {cluster.count === 1 ? "sample" : "samples"} ·{" "}
            {cluster.totalBgc.toLocaleString()} BGCs
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground underline-offset-2 hover:underline"
          aria-label="Close samples panel"
        >
          Close
        </button>
      </div>
      <ul className={`divide-y divide-border overflow-y-auto border border-border ${overlay ? "min-h-0 flex-1" : "max-h-[280px]"}`}>
        {cluster.samples
          .slice()
          .sort((a, b) => b.bgcCount - a.bgcCount)
          .map((s) => {
            const color = GOLD_BUCKET_COLOR[s.bucket];
            const stroke = bucketStroke(s.bucket);
            const label = s.name ?? s.externalId ?? s.id;
            return (
              <li
                key={s.id}
                className={`grid items-center px-3 py-2 text-[12.5px] ${compact
                  ? "grid-cols-[auto_1fr_auto] gap-x-2 gap-y-1"
                  : "grid-cols-[auto_1fr_auto_auto] gap-3"}`}
              >
                <span
                  className="inline-block size-2.5 shrink-0 rounded-full"
                  style={{
                    background: color,
                    boxShadow: `inset 0 0 0 ${stroke.weight}px ${stroke.color}`,
                  }}
                  aria-hidden
                />
                <div className="min-w-0">
                  <div className="truncate font-medium text-foreground">
                    {label}
                  </div>
                  {s.goldEcosystemPath ? (
                    <div className="truncate font-mono text-[10.5px] text-muted-foreground opacity-80">
                      {s.goldEcosystemPath}
                    </div>
                  ) : (
                    <div className="font-mono text-[10.5px] text-muted-foreground opacity-60">
                      {GOLD_BUCKET_LABEL[s.bucket]}
                    </div>
                  )}
                </div>
                <span className="font-mono tabular-nums text-muted-foreground">
                  {s.bgcCount.toLocaleString()} BGCs
                </span>
                <div className={`flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider ${compact ? "col-span-2 col-start-2 row-start-2" : ""}`}>
                  <Link
                    href={`/samples/${encodeURIComponent(s.id)}`}
                    className="text-foreground underline-offset-2 hover:underline"
                  >
                    Sample →
                  </Link>
                  <Link
                    href={`/bgcs?sampleId=${encodeURIComponent(s.id)}`}
                    className="text-foreground underline-offset-2 hover:underline"
                  >
                    BGCs →
                  </Link>
                </div>
              </li>
            );
          })}
      </ul>
    </div>
  );
}
