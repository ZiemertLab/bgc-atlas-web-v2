"use client";

import React, { useMemo, useRef, useState } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartSkeleton } from '@/components/ui/chart-skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { HorizontalBarChart, type HorizontalBarDatum } from '@/components/charts/horizontal-bar-chart';
import type { SampleChartBucket, SampleGroupByOption, UseSampleStatsParams } from '@/lib/hooks/use-sample-stats';
import { useSampleStats, useSampleHierarchy } from '@/lib/hooks/use-sample-stats';
import { useDebouncedCallback } from '@/lib/utils/debounce';
import { useQuery } from '@tanstack/react-query';
import { withBase } from '@/lib/basePath';
import {
  getGOLDColorHex, getEcosystemChartColorHex, goldBarLabels, goldPathTitle,
  isGoldPlantsPath, isGoldAquaticPath, GOLD_PLANTS_COLOR_HEX, GOLD_AQUATIC_COLOR_HEX,
} from '@/lib/utils/gold-parser';
import { Button } from '@/components/ui/button';
import { ChartBarBig, Sun } from 'lucide-react';
import { SampleSunburst } from './SampleSunburst.client';
import { CollapsibleSection } from '@/components/ui/collapsible-section';
import { useMediaQuery } from '@/lib/hooks/use-media-query';

// The API strips the `root:` prefix, so level 1 is the first segment. Bars are coloured
// by it, except the Host-associated:Plants (green) and Environmental:Aquatic (blue) subtrees.
const goldLevel1Name = (name: string): string => name.split(':')[0].trim() || 'Unknown';

/** The long-tail bucket the distribution API appends; neutral, and always last. */
const OTHERS = 'Others';

type StaticSampleChartsManifest = { version: string; url: string };
type StaticSampleChartsPayload = { byVariant: Record<string, SampleChartBucket[]> };

// /samples spreads extra filter fields (biome, goldBucket, environment) onto the
// params, which buildUrl() forwards.
type FilterShape = UseSampleStatsParams & Record<string, unknown>;

const hasActiveSampleFilters = (f: FilterShape): boolean => Boolean(
  f.search || f.id || f.biome || f.environmentText || f.material || f.feature ||
  f.host || f.dataSource || f.study ||
  (f.latMin !== undefined && f.latMin !== null) ||
  (f.latMax !== undefined && f.latMax !== null) ||
  (f.lonMin !== undefined && f.lonMin !== null) ||
  (f.lonMax !== undefined && f.lonMax !== null) ||
  (f.assembliesMin !== undefined && f.assembliesMin !== null) ||
  (f.assembliesMax !== undefined && f.assembliesMax !== null) ||
  (f.bgcsMin !== undefined && f.bgcsMin !== null) ||
  (f.bgcsMax !== undefined && f.bgcsMax !== null) ||
  (f.gcfsMin !== undefined && f.gcfsMin !== null) ||
  (f.gcfsMax !== undefined && f.gcfsMax !== null) ||
  f.goldBucket || f.environment || f.advancedFilters ||
  (Array.isArray(f.sourceType) ? f.sourceType.length > 0 : Boolean(f.sourceType))
);

/** Distribution buckets as bars of one metric, coloured by their GOLD subtree. */
const toBars = (buckets: SampleChartBucket[], valueKey: 'samples' | 'bgcs', noun: string): HorizontalBarDatum[] => {
  const labels = goldBarLabels(buckets.map((bucket) => bucket.name).filter((name) => name !== OTHERS));
  return buckets.map((bucket) => {
    const others = bucket.name === OTHERS;
    return {
      key: bucket.name,
      label: labels.get(bucket.name) ?? bucket.name,
      title: others ? bucket.name : goldPathTitle(bucket.name),
      value: bucket[valueKey],
      color: others ? 'var(--muted-foreground)' : getEcosystemChartColorHex(bucket.name),
      details: [`${bucket[valueKey].toLocaleString()} ${noun}`],
    };
  });
};

// The per-sample view drops ecosystems too small for a mean to mean anything,
// as the Genome collections per-genome view does.
const MIN_PER_UNIT = 10;
const PER_UNIT_TOP_N = 20;

const PER_UNIT_LEVELS = [1, 2, 3, 4, 5] as const;
type PerUnitLevel = (typeof PER_UNIT_LEVELS)[number];

/**
 * Mean BGCs per sample (or genome) for each GOLD path cut at `level`, from the
 * hierarchy rows the sunburst already fetched: BGCs ÷ samples summed over every
 * path under it. A sample whose path stops short of `level` has no ecosystem at
 * that depth and is left out rather than credited to its parent.
 */
function perUnitBars(
  rows: Array<{ path: string; samples: number; bgcs: number }>,
  level: PerUnitLevel,
  unit: string,
  units: string,
): HorizontalBarDatum[] {
  const agg = new Map<string, { samples: number; bgcs: number }>();
  for (const row of rows) {
    const parts = row.path.split(':').map((p) => p.trim()).filter(Boolean);
    if (parts.length < level) continue;
    const key = parts.slice(0, level).join(':');
    const entry = agg.get(key) ?? { samples: 0, bgcs: 0 };
    entry.samples += row.samples;
    entry.bgcs += row.bgcs;
    agg.set(key, entry);
  }
  const top = [...agg.entries()]
    .filter(([, v]) => v.samples >= MIN_PER_UNIT)
    .map(([key, v]) => ({ key, ...v, ratio: v.bgcs / v.samples }))
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, PER_UNIT_TOP_N);
  const labels = goldBarLabels(top.map((d) => d.key));
  return top
    .map((d) => ({
      key: d.key,
      label: labels.get(d.key) ?? d.key,
      title: goldPathTitle(d.key),
      value: d.ratio,
      color: getEcosystemChartColorHex(d.key),
      details: [
        `${d.ratio.toFixed(1)} BGCs per ${unit}`,
        `${d.bgcs.toLocaleString()} BGCs across ${d.samples.toLocaleString()} ${units}`,
      ],
    }));
}

const groupByOptions: Array<{ value: SampleGroupByOption; label: string }> = [
  { value: 'gold_level_1', label: 'GOLD Level 1 (Top-level)' },
  { value: 'gold_level_2', label: 'GOLD Level 2' },
  { value: 'gold_level_3', label: 'GOLD Level 3' },
  { value: 'gold_level_4', label: 'GOLD Level 4' },
  { value: 'gold_level_5', label: 'GOLD Level 5' },
];

interface SampleChartsProps extends FilterShape {
  /**
   * Manifest (relative to basePath) for the unfiltered snapshot from
   * scripts/generate-sample-charts-snapshot.ts; any active filter uses the live endpoint.
   */
  staticManifestUrl?: string;
  distributionTitle?: string;
  metricLabel?: string;
  unitLabel?: string;
}

const SampleChartsBody = ({
  staticManifestUrl,
  distributionTitle = 'Sample distribution',
  metricLabel = 'Samples',
  unitLabel = 'samples',
  embedded = false,
  ...filters
}: SampleChartsProps & { embedded?: boolean }) => {
  // Inside the mobile CollapsibleSection the panel is already the container.
  const cardClass = embedded ? 'gap-2 border-0 bg-transparent py-0' : undefined;
  const cardPad = embedded ? 'px-0' : undefined;
  const [chartView, setChartView] = useState<'sunburst' | 'bars'>('sunburst');
  const sunburstActive = chartView === 'sunburst';
  const barsActive = !sunburstActive;

  const useStatic = Boolean(staticManifestUrl) && !hasActiveSampleFilters(filters);
  const [groupBy, setGroupBy] = useState<SampleGroupByOption>('gold_level_1');

  const [pendingGroupBy, setPendingGroupBy] = useState<SampleGroupByOption>('gold_level_1');

  const sampleContainerRef = useRef<HTMLDivElement>(null);
  const bgcContainerRef = useRef<HTMLDivElement>(null);
  // The BGC-yield sunburst's companion view, as on the taxonomy charts: a total
  // favours whichever ecosystem has the most samples, a mean per sample does not.
  const [bgcMode, setBgcMode] = useState<'total' | 'perUnit'>('total');
  const [perUnitLevel, setPerUnitLevel] = useState<PerUnitLevel>(3);
  const unit = unitLabel.replace(/s$/, '');

  const debouncedSetGroupBy = useDebouncedCallback((value: SampleGroupByOption) => {
    setGroupBy(value);
  }, 300);

  const handleGroupByChange = (value: SampleGroupByOption) => {
    setPendingGroupBy(value);
    if (useStatic) {
      setGroupBy(value);
    } else {
      debouncedSetGroupBy(value);
    }
  };

  const staticQuery = useQuery({
    queryKey: ['sample-charts-snapshot', staticManifestUrl],
    enabled: useStatic && barsActive,
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async ({ signal }) => {
      const manifestRes = await fetch(withBase(staticManifestUrl!), { signal, cache: 'no-cache' });
      if (!manifestRes.ok) throw new Error(`Sample charts manifest fetch failed: ${manifestRes.status}`);
      const manifest = (await manifestRes.json()) as StaticSampleChartsManifest;
      const dataRes = await fetch(withBase(manifest.url), { signal });
      if (!dataRes.ok) throw new Error(`Sample charts data fetch failed: ${dataRes.status}`);
      return (await dataRes.json()) as StaticSampleChartsPayload;
    },
  });

  const { data: response, isLoading: liveLoading, error: liveError } = useSampleStats(
    {
      ...filters,
      groupBy,
      limit: 15,
    },
    { enabled: !useStatic && barsActive },
  );

  const { data: hierResponse, isLoading: hierLoading, error: hierError } = useSampleHierarchy(
    filters,
    { enabled: sunburstActive },
  );
  const hierarchyData = useMemo(() => hierResponse?.data?.hierarchy ?? [], [hierResponse]);

  const isLoading = sunburstActive
    ? hierLoading
    : (useStatic ? staticQuery.isLoading : liveLoading);
  const error = sunburstActive
    ? hierError
    : (useStatic ? ((staticQuery.error as Error | null) ?? null) : liveError);

  const distributionData = useMemo(() => {
    if (useStatic) {
      return staticQuery.data?.byVariant[groupBy] ?? [];
    }
    return response?.data?.distribution || [];
  }, [useStatic, staticQuery.data, response, groupBy]);

  const sampleBars = useMemo(() => toBars(distributionData, 'samples', unitLabel), [distributionData, unitLabel]);
  const bgcBars = useMemo(() => toBars(distributionData, 'bgcs', 'BGCs'), [distributionData]);
  const perUnit = useMemo(
    () => perUnitBars(hierarchyData, perUnitLevel, unit, unitLabel),
    [hierarchyData, perUnitLevel, unit, unitLabel],
  );

  // Declared before any early return to keep hook order stable.
  const legendItems = useMemo(() => {
    const seen = new Map<string, string>();
    // Whether the active data breaks out the Host-associated:Plants or
    // Environmental:Aquatic subtree, which are coloured apart from their top
    // level — surfaced as their own legend entries so the exception is explained.
    let hasPlants = false;
    let hasAquatic = false;
    if (sunburstActive) {
      for (const row of hierarchyData) {
        const lvl1 = row.path.split(':')[0].trim();
        if (lvl1 && !seen.has(lvl1)) seen.set(lvl1, getGOLDColorHex(lvl1));
        if (isGoldPlantsPath(row.path)) hasPlants = true;
        if (isGoldAquaticPath(row.path)) hasAquatic = true;
      }
    } else {
      for (const bucket of distributionData) {
        // "Others" names itself beside its bar; it is not an ecosystem to key.
        if (bucket.name === OTHERS) continue;
        const name = goldLevel1Name(bucket.name);
        if (!seen.has(name)) seen.set(name, getGOLDColorHex(bucket.name));
        if (isGoldPlantsPath(bucket.name)) hasPlants = true;
        if (isGoldAquaticPath(bucket.name)) hasAquatic = true;
      }
    }
    const items = Array.from(seen, ([name, color]) => ({ name, color }));
    if (hasAquatic) items.push({ name: 'Environmental: Aquatic', color: GOLD_AQUATIC_COLOR_HEX });
    if (hasPlants) items.push({ name: 'Host-assoc.: Plants', color: GOLD_PLANTS_COLOR_HEX });
    return items;
  }, [sunburstActive, hierarchyData, distributionData]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <Card className={cardClass}>
          <CardHeader className={cardPad}><CardTitle>{distributionTitle}</CardTitle></CardHeader>
          <CardContent className={cardPad}><ChartSkeleton height={400} /></CardContent>
        </Card>
        <Card className={cardClass}>
          <CardHeader className={cardPad}><CardTitle>BGC yield</CardTitle></CardHeader>
          <CardContent className={cardPad}><ChartSkeleton height={400} /></CardContent>
        </Card>
      </div>
    );
  }

  if (error || (barsActive && !useStatic && !response?.success)) {
    return (
      <div className="py-8 text-center text-sm">
        <p className="font-semibold text-destructive">Failed to load sample statistics</p>
        {error ? (
          <p className="mx-auto mt-2 max-w-prose text-muted-foreground">{error.message}</p>
        ) : null}
      </div>
    );
  }

  const groupLabel = groupByOptions.find(o => o.value === pendingGroupBy)?.label || 'Biome';

  return (
    <div className="space-y-6">
      {/* The dropdown drives both charts; outside the cards it also keeps their
          headers the same height, so the x-axes line up. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {legendItems.length > 0 ? (
          <div
            className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground"
            aria-label="GOLD Level 1 color legend"
          >
            <span className="font-medium text-foreground">GOLD Level 1:</span>
            {legendItems.map(({ name, color }) => (
              <span key={name} className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="inline-block size-2.5 rounded-[2px]"
                  style={{ backgroundColor: color }}
                />
                {name}
              </span>
            ))}
          </div>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          {barsActive && (
            <Select value={pendingGroupBy} onValueChange={(v) => handleGroupByChange(v as SampleGroupByOption)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {groupByOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="inline-flex rounded-sm border border-input">
            <Button
              variant={sunburstActive ? 'default' : 'ghost'}
              size="sm"
              className="rounded-none border-r border-border"
              onClick={() => setChartView('sunburst')}
            >
              <Sun className="size-3.5" />
              Sunburst
            </Button>
            <Button
              variant={barsActive ? 'default' : 'ghost'}
              size="sm"
              className="rounded-none"
              onClick={() => setChartView('bars')}
            >
              <ChartBarBig className="size-3.5" />
              Bars
            </Button>
          </div>
        </div>
      </div>

      {/* Sunburst view: the cards stretch to one height, so a Per sample bar card
          ends where the sunburst beside it does. Bars view: each card keeps its
          own height. */}
      <div className={`grid grid-cols-1 gap-8 lg:grid-cols-2 ${sunburstActive ? '' : 'items-start'}`}>
        {sunburstActive ? (
          <>
            <Card className={cardClass}>
              {/* min-h-9 matches the BGC-yield header, whose toggle is 36px, so the two sunbursts sit level. */}
              <CardHeader className={`flex min-h-9 items-center ${cardPad ?? ''}`}>
                <CardTitle className="whitespace-nowrap">{distributionTitle}</CardTitle>
              </CardHeader>
              <CardContent className={cardPad}>
                {hierarchyData.length > 0 ? (
                  <SampleSunburst data={hierarchyData} metric="samples" containerRef={sampleContainerRef} unitLabel={unitLabel} />
                ) : (
                  <p className="py-8 text-center text-sm text-muted-foreground">No ecosystem data.</p>
                )}
              </CardContent>
            </Card>

            <Card className={cardClass}>
              <CardHeader className={`flex min-h-9 flex-row flex-wrap items-center justify-between gap-2 space-y-0 ${cardPad ?? ''}`}>
                <CardTitle className="whitespace-nowrap">BGC yield</CardTitle>
                <div className="flex items-center gap-2">
                  {bgcMode === 'perUnit' && (
                    <Select value={String(perUnitLevel)} onValueChange={(v) => setPerUnitLevel(Number(v) as PerUnitLevel)}>
                      <SelectTrigger className="h-7 w-auto min-w-24 px-2 text-xs" aria-label="GOLD level">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PER_UNIT_LEVELS.map((level) => (
                          <SelectItem key={level} value={String(level)}>GOLD level {level}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <div className="inline-flex rounded-md border bg-background p-0.5">
                    <Button
                      type="button"
                      size="sm"
                      variant={bgcMode === 'total' ? 'secondary' : 'ghost'}
                      className="h-7 px-3 text-xs"
                      aria-pressed={bgcMode === 'total'}
                      onClick={() => setBgcMode('total')}
                    >
                      Total
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={bgcMode === 'perUnit' ? 'secondary' : 'ghost'}
                      className="h-7 px-3 text-xs"
                      aria-pressed={bgcMode === 'perUnit'}
                      onClick={() => setBgcMode('perUnit')}
                    >
                      Per {unit}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className={`flex flex-1 flex-col ${cardPad ?? ''}`}>
                {hierarchyData.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No ecosystem data.</p>
                ) : bgcMode === 'total' ? (
                  <SampleSunburst data={hierarchyData} metric="bgcs" containerRef={bgcContainerRef} unitLabel={unitLabel} />
                ) : perUnit.length > 0 ? (
                  <>
                    <p className="mb-3 text-xs text-muted-foreground">
                      Mean BGCs per {unit} — top {PER_UNIT_TOP_N} ecosystems with ≥ {MIN_PER_UNIT} {unitLabel}.
                    </p>
                    <HorizontalBarChart
                      data={perUnit}
                      formatValue={(d) => `${d.value.toFixed(1)} / ${unit}`}
                      label={`Mean BGCs per ${unit} by GOLD ecosystem`}
                      className="flex-1"
                      fill
                    />
                  </>
                ) : (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No ecosystem at this level has {MIN_PER_UNIT} {unitLabel}.
                  </p>
                )}
              </CardContent>
            </Card>
          </>
        ) : (
          <>
            <Card className={cardClass}>
              <CardHeader className={cardPad}>
                <CardTitle className="whitespace-nowrap">{distributionTitle} by {groupLabel}</CardTitle>
              </CardHeader>
              <CardContent className={cardPad}>
                <HorizontalBarChart data={sampleBars} label={`${metricLabel} by GOLD ecosystem`} />
              </CardContent>
            </Card>

            <Card className={cardClass}>
              <CardHeader className={cardPad}>
                <CardTitle className="whitespace-nowrap">BGC yield by {groupLabel}</CardTitle>
              </CardHeader>
              <CardContent className={cardPad}>
                <HorizontalBarChart data={bgcBars} label="BGCs by GOLD ecosystem" />
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
};

/**
 * Below md the charts (about 1,300px tall) fold into one closed section. Radix
 * unmounts closed content, so nothing is fetched or drawn until it is opened.
 */
export const SampleCharts = (props: SampleChartsProps) => {
  const narrow = useMediaQuery('(max-width: 767px)');
  if (!narrow) return <SampleChartsBody {...props} />;
  return (
    <CollapsibleSection title="Ecosystem distribution">
      <SampleChartsBody {...props} embedded />
    </CollapsibleSection>
  );
};
