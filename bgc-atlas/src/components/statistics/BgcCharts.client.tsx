"use client";

import React, { useMemo, useState } from 'react';

import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChartSkeleton } from '@/components/ui/chart-skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { HorizontalBarChart, hatchBackground, type HorizontalBarDatum } from '@/components/charts/horizontal-bar-chart';
import { getProductCategoryColor } from '@/lib/utils/chart-utils';
import type { ChartBucket, GroupByOption } from '@/lib/hooks/use-bgc-stats';
import { useBgcStats } from '@/lib/hooks/use-bgc-stats';
import { useBgcDistribution } from '@/lib/hooks/use-bgc-distribution';
import type { DistributionVariant, ProductClassBucket } from '@/lib/opensearch/bgc-distribution';
import type { UseBgcsParams } from '@/lib/hooks/use-bgcs';
import {
  getEcosystemChartColorHex,
  goldBarLabels,
  goldPathTitle,
  GOLD_LEVEL1_COLOR_HEX,
  GOLD_UNKNOWN_COLOR_HEX,
  GOLD_PLANTS_COLOR_HEX,
  GOLD_AQUATIC_COLOR_HEX,
} from '@/lib/utils/gold-parser';
import { useDebouncedCallback } from '@/lib/utils/debounce';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { withBase } from '@/lib/basePath';

/** The long-tail bucket the distribution API appends; neutral, and always last. */
const OTHERS = 'Others';
const OTHERS_COLOR = 'var(--muted-foreground)';

const GOLD_LEGEND_ITEMS: Array<{ label: string; color: string }> = [
  { label: 'Environmental', color: GOLD_LEVEL1_COLOR_HEX['environmental'] },
  { label: 'Environmental: Aquatic', color: GOLD_AQUATIC_COLOR_HEX },
  { label: 'Host-associated', color: GOLD_LEVEL1_COLOR_HEX['host-associated'] },
  { label: 'Engineered', color: GOLD_LEVEL1_COLOR_HEX['engineered'] },
  { label: 'Mixed', color: GOLD_LEVEL1_COLOR_HEX['mixed'] },
  { label: 'Unknown', color: GOLD_UNKNOWN_COLOR_HEX },
  { label: 'Host-assoc.: Plants', color: GOLD_PLANTS_COLOR_HEX },
];

/**
 * The GOLD swatches for the bars actually drawn. Bars are coloured by
 * getEcosystemChartColorHex, so a swatch whose colour no bar carries (Aquatic
 * and Plants at level 1, where those subtrees fold into their top level) would
 * be a key to nothing. "Others" names itself beside its bar and is not an
 * ecosystem, so it never pulls in the Unknown swatch.
 */
const goldLegendItemsFor = (bars: ChartBucket[]) => {
  const drawn = new Set(bars.filter((bar) => bar.name !== OTHERS).map((bar) => getEcosystemChartColorHex(bar.name)));
  return GOLD_LEGEND_ITEMS.filter((item) => drawn.has(item.color));
};

const Legend = ({ goldBars }: { goldBars?: ChartBucket[] }) => {
  const goldItems = useMemo(() => (goldBars ? goldLegendItemsFor(goldBars) : []), [goldBars]);
  // Solid vs hatched is the one encoding every bar shares, whatever its colour,
  // so its key is drawn in a neutral grey rather than in any one bar's hue.
  return (
    <CardFooter className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 pt-4 text-sm">
      <div className="flex items-center gap-2">
        <div className="h-4 w-4 rounded-sm bg-muted-foreground" />
        <span>Complete</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="h-4 w-4 rounded-sm" style={{ background: hatchBackground('var(--muted-foreground)') }} />
        <span>Partial <span className="text-muted-foreground">(on contig edge)</span></span>
      </div>
      {goldItems.map((item) => (
        <div key={item.label} className="flex items-center gap-2">
          <div className="h-4 w-4 rounded-sm" style={{ backgroundColor: item.color }} />
          <span>{item.label}</span>
        </div>
      ))}
    </CardFooter>
  );
};

/** Buckets as bars: whole bar = all BGCs, hatched share = those on a contig edge. */
const toBars = (buckets: ChartBucket[], kind: 'category' | 'gold'): HorizontalBarDatum[] => {
  const goldLabels = kind === 'gold'
    ? goldBarLabels(buckets.map((bucket) => bucket.name).filter((name) => name !== OTHERS))
    : null;
  return buckets.map((bucket) => {
    const total = bucket.complete + bucket.partial;
    const others = bucket.name === OTHERS;
    return {
      key: bucket.name,
      label: goldLabels?.get(bucket.name) ?? bucket.name,
      title: kind === 'gold' && !others ? goldPathTitle(bucket.name) : bucket.name,
      value: total,
      partial: bucket.partial,
      color: others
        ? OTHERS_COLOR
        : kind === 'gold' ? getEcosystemChartColorHex(bucket.name) : getProductCategoryColor(bucket.name),
      details: [
        `Complete: ${bucket.complete.toLocaleString()}`,
        `Partial: ${bucket.partial.toLocaleString()}`,
        `Total: ${total.toLocaleString()}`,
      ],
    };
  });
};

/** antiSMASH classes as bars, each in the colour of the category most of its BGCs carry. */
const toClassBars = (rows: ProductClassBucket[]): HorizontalBarDatum[] =>
  rows.map((row) => {
    const total = row.complete + row.partial;
    const others = row.name === OTHERS;
    return {
      key: row.name,
      label: row.name,
      value: total,
      partial: row.partial,
      color: others || !row.category ? OTHERS_COLOR : getProductCategoryColor(row.category),
      details: [
        ...(row.category && !others ? [`Mostly ${row.category}`] : []),
        `Complete: ${row.complete.toLocaleString()}`,
        `Partial: ${row.partial.toLocaleString()}`,
        `Total: ${total.toLocaleString()}`,
      ],
    };
  });
const groupByOptions: Array<{ value: GroupByOption; label: string }> = [
  { value: 'gold_level_1', label: 'GOLD Level 1 (Top-level)' },
  { value: 'gold_level_2', label: 'GOLD Level 2' },
  { value: 'gold_level_3', label: 'GOLD Level 3' },
  { value: 'gold_level_4', label: 'GOLD Level 4' },
  { value: 'gold_level_5', label: 'GOLD Level 5' },
];

const cleanClassName = (name: string | null): string => {
  if (!name) return 'Unknown';
  return name.replace(/[{}]/g, '');
};

const processChartData = (buckets: ChartBucket[]) =>
  buckets
    .filter((bucket) => bucket.complete > 0 || bucket.partial > 0)
    .map(bucket => ({
      ...bucket,
      name: cleanClassName(bucket.name)
    }))
    // "Others" aggregates the long tail; pin it last instead of sorting by size.
    .sort((a, b) => {
      if (a.name === 'Others') return 1;
      if (b.name === 'Others') return -1;
      return b.complete + b.partial - (a.complete + a.partial);
    });

const distributionTitleMap: Record<GroupByOption, () => string> = {
  gold_level_1: () => 'Distribution by GOLD ecosystem (level 1)',
  gold_level_2: () => 'Distribution by GOLD ecosystem (level 2)',
  gold_level_3: () => 'Distribution by GOLD ecosystem (level 3)',
  gold_level_4: () => 'Distribution by GOLD ecosystem (level 4)',
  gold_level_5: () => 'Distribution by GOLD ecosystem (level 5)',
  biome: () => 'Distribution by biome',
  environment: () => 'Distribution by environment',
  feature: () => 'Distribution by environment feature',
  material: () => 'Distribution by environment material',
};

type StaticChartsPayload = {
  categoryDistribution: ChartBucket[];
  /** antiSMASH classes, top 20 + Others. Absent from older snapshots. */
  classDistribution?: ProductClassBucket[];
  byVariant: Record<string, ChartBucket[]>;
  /** Optional: older snapshots lack it, and the coverage line then omits the count. */
  totalBgcs?: number;
};

type StaticChartsManifest = {
  version: string;
  url: string;
};

interface BgcChartsProps {
  /**
   * Manifest (relative to basePath) pointing at a snapshot from
   * scripts/generate-bgc-charts-snapshot.ts. Omitted: use /api/statistics/bgcs.
   */
  staticManifestUrl?: string;
  /** When `filtered` is true the charts re-aggregate over exactly these BGCs. */
  params?: UseBgcsParams;
  filtered?: boolean;
}

/** Stable identity so an unfiltered render does not rebuild the query key. */
const NO_PARAMS: UseBgcsParams = {};

const variantKey = (groupBy: GroupByOption, level: number) =>
  groupBy === 'biome' ? `biome_${level}` : groupBy;

export const BgcCharts = ({ staticManifestUrl, params, filtered = false }: BgcChartsProps = {}) => {
  const useStatic = Boolean(staticManifestUrl);
  const [groupBy, setGroupBy] = useState<GroupByOption>('gold_level_1');
  const [biomeLevel] = useState<number>(1);

  const [pendingGroupBy, setPendingGroupBy] = useState<GroupByOption>('gold_level_1');


  const debouncedSetGroupBy = useDebouncedCallback((value: GroupByOption) => {
    setGroupBy(value);
  }, 300);

  const handleGroupByChange = (value: GroupByOption) => {
    setPendingGroupBy(value);
    if (useStatic) {
      setGroupBy(value);
    } else {
      debouncedSetGroupBy(value);
    }
  };

  const staticQuery = useQuery({
    queryKey: ['bgc-charts-snapshot', staticManifestUrl],
    enabled: useStatic,
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async ({ signal }) => {
      const manifestRes = await fetch(withBase(staticManifestUrl!), { signal, cache: 'no-cache' });
      if (!manifestRes.ok) throw new Error(`BGC charts manifest fetch failed: ${manifestRes.status}`);
      const manifest = (await manifestRes.json()) as StaticChartsManifest;
      const dataRes = await fetch(withBase(manifest.url), { signal });
      if (!dataRes.ok) throw new Error(`BGC charts data fetch failed: ${dataRes.status}`);
      return (await dataRes.json()) as StaticChartsPayload;
    },
  });

  // Always called to keep hook order stable; `enabled` gates the fetches.
  const { data: classResponse, isLoading: classLoading, error: classError } = useBgcStats({
    groupBy: 'biome',
    level: 1,
    limit: 20,
  }, { enabled: !useStatic });
  const { data: distributionResponse, isLoading: distLoading, error: distError } = useBgcStats({
    groupBy,
    level: groupBy === 'biome' ? biomeLevel : undefined,
    limit: 20,
  }, { enabled: !useStatic });

  // Always called so hook order is stable across a filter toggle.
  const live = useBgcDistribution(
    params ?? NO_PARAMS,
    variantKey(groupBy, biomeLevel) as DistributionVariant,
    { enabled: filtered },
  );

  // The left card's Product view (antiSMASH class). Filtered, the class tallies are a
  // separate request made only once the view is opened: that agg costs as much as the
  // rest of the distribution request together.
  const [leftView, setLeftView] = useState<'category' | 'class'>('category');
  const liveClasses = useBgcDistribution(
    params ?? NO_PARAMS,
    variantKey(groupBy, biomeLevel) as DistributionVariant,
    { enabled: filtered && leftView === 'class', withClasses: true },
  );
  const showingLiveClasses = filtered && leftView === 'class'
    && !liveClasses.unsupported && !liveClasses.error && Boolean(liveClasses.data?.classDistribution);

  // ?advancedFilters and the map bbox send the table to the SQL fallback, which
  // this aggregation cannot reproduce; the snapshot is shown there instead.
  const showingLive = filtered && !live.unsupported && !live.error && Boolean(live.data);
  const refreshing = live.isFetching && !live.isLoading;

  const isLoading = useStatic
    ? staticQuery.isLoading || (filtered && live.isLoading)
    : (classLoading || distLoading);
  const error = useStatic
    ? (staticQuery.error as Error | null) ?? null
    : (classError || distError);

  const classData = useMemo(() => {
    const buckets: ChartBucket[] = showingLive
      ? live.data!.categoryDistribution
      : useStatic
        ? staticQuery.data?.categoryDistribution ?? []
        : classResponse?.data?.bgcCategoryDistribution ?? [];
    return processChartData(buckets);
  }, [showingLive, live.data, useStatic, staticQuery.data, classResponse]);

  const distributionData = useMemo(() => {
    const buckets: ChartBucket[] = showingLive
      ? live.data!.distribution
      : useStatic
        ? staticQuery.data?.byVariant[variantKey(groupBy, biomeLevel)] ?? []
        : distributionResponse?.data?.distribution ?? [];
    return processChartData(buckets);
  }, [showingLive, live.data, useStatic, staticQuery.data, distributionResponse, groupBy, biomeLevel]);

  const classBars = useMemo(() => toBars(classData, 'category'), [classData]);
  const productClassBars = useMemo(
    () => toClassBars(showingLiveClasses
      ? liveClasses.data!.classDistribution!
      : staticQuery.data?.classDistribution ?? []),
    [showingLiveClasses, liveClasses.data, staticQuery.data],
  );
  const distributionBars = useMemo(() => toBars(distributionData, 'gold'), [distributionData]);

  const payload = useStatic ? staticQuery.data : distributionResponse?.data;

  if (isLoading) {
    return (
      <div className="flex flex-col gap-8 lg:only:col-span-2 lg:only:grid lg:only:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="whitespace-nowrap">Category distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartSkeleton height={400} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Distribution by GOLD ecosystem (level 1)</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartSkeleton height={400} />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !payload) {
    return (
      <div className="text-center text-muted-foreground py-8">
        <p>Failed to load BGC statistics. Please try again.</p>
      </div>
    );
  }

  const corpusTotal = staticQuery.data?.totalBgcs;
  const unfilteredNote = corpusTotal !== undefined
    ? `all ${corpusTotal.toLocaleString()} BGCs${filtered ? ' · not filtered by your current selection' : ''}`
    : filtered ? 'not filtered by your current selection' : undefined;

  // A BGC can carry several categories (and several products), so these bars
  // sum past the BGC count; the caption says so rather than inviting a sum.
  const multiLabelNote = leftView === 'class'
    ? 'bars are product assignments, and a BGC can carry several'
    : 'bars are category assignments, and a BGC can carry several';
  // "Product" is what the table, the filters and the exports call
  // product_type; the code keeps the antiSMASH name, class.
  const classCoverage = leftView === 'class'
    ? showingLiveClasses
      ? `${liveClasses.data!.totalBgcs.toLocaleString()} BGCs matching your filters · top 20 products · ${multiLabelNote}`
      : `${unfilteredNote ? `${unfilteredNote} · ` : ''}top 20 products · ${multiLabelNote}`
    : showingLive
      ? `${live.data!.totalBgcs.toLocaleString()} BGCs matching your filters · ${multiLabelNote}`
      : unfilteredNote ? `${unfilteredNote} · ${multiLabelNote}` : multiLabelNote;
  // A snapshot from before the class tallies existed has none to switch to.
  const classViewAvailable = Boolean(staticQuery.data?.classDistribution?.length) || filtered;
  const classViewLoading = leftView === 'class' && filtered && liveClasses.isLoading;
  const leftRefreshing = leftView === 'class' ? liveClasses.isFetching && !liveClasses.isLoading : refreshing;

  // The ecosystem bars drop every BGC whose GOLD path stops short of the level
  // shown, so the line says how many are drawn, never "all N".
  const gapNote = (charted: number, total: number) =>
    ` · ${(100 - (charted / total) * 100).toFixed(1)}% have no GOLD path this deep`;
  const snapshotCharted = distributionData.reduce((sum, b) => sum + b.complete + b.partial, 0);
  const ecosystemCoverage = showingLive
    ? live.data!.chartedBgcs === live.data!.totalBgcs
      ? `${live.data!.totalBgcs.toLocaleString()} BGCs matching your filters`
      : `${live.data!.chartedBgcs.toLocaleString()} of ${live.data!.totalBgcs.toLocaleString()} BGCs matching your filters`
        + gapNote(live.data!.chartedBgcs, live.data!.totalBgcs)
    : corpusTotal !== undefined && snapshotCharted > 0 && snapshotCharted < corpusTotal
      ? `${snapshotCharted.toLocaleString()} of ${corpusTotal.toLocaleString()} BGCs`
        + gapNote(snapshotCharted, corpusTotal)
        + (filtered ? ' · not filtered by your current selection' : '')
      : unfilteredNote;

  // Each card hides when empty: a narrow filter can match classes but no GOLD
  // path as deep as the selected level.
  const showClass = classData.length > 0;
  const matchHeights = leftView === 'class' && pendingGroupBy !== 'gold_level_1';
  const showEcosystem = distributionData.length > 0;
  if (!showClass && !showEcosystem) return null;

  return (
    /* As the only child of the page's two-column grid the cards sit side by side.
       Product view beside GOLD level 2+ is ~20 rows each, so the two stretch to one
       height; any other pairing keeps its own height, since spreading a handful of
       bars over 600px reads as a gap. */
    <div className={`flex flex-col gap-8 lg:only:col-span-2 ${showClass && showEcosystem ? `lg:only:grid lg:only:grid-cols-2 ${matchHeights ? '' : 'lg:only:items-start'}` : ''}`}>
        {showClass && <Card className="grow">
          {/* min-h-9 matches the ecosystem card's select, so the two charts start level. */}
          <CardHeader className="flex min-h-9 flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="min-w-0 whitespace-nowrap">
              {leftView === 'class' ? 'Product distribution' : 'Category distribution'}
            </CardTitle>
            <div className="flex items-center gap-2">
              {/* Previous data stays on screen during a refetch, which can take seconds. */}
              <Loader2
                aria-hidden={!leftRefreshing}
                className={`size-3.5 shrink-0 animate-spin text-muted-foreground transition-opacity ${
                  leftRefreshing ? 'opacity-100' : 'opacity-0'
                }`}
              />
              {classViewAvailable && (
                <div className="inline-flex rounded-md border bg-background p-0.5">
                  <Button
                    type="button"
                    size="sm"
                    variant={leftView === 'category' ? 'secondary' : 'ghost'}
                    className="h-7 px-3 text-xs"
                    aria-pressed={leftView === 'category'}
                    onClick={() => setLeftView('category')}
                  >
                    Category
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={leftView === 'class' ? 'secondary' : 'ghost'}
                    className="h-7 px-3 text-xs"
                    aria-pressed={leftView === 'class'}
                    onClick={() => setLeftView('class')}
                  >
                    Product
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          {classCoverage && <div className="-mt-2 px-6 pb-3 text-xs text-muted-foreground">{classCoverage}</div>}
          <CardContent className="flex flex-1 flex-col">
            {classViewLoading ? (
              <ChartSkeleton height={360} />
            ) : (
              <div className={`flex flex-1 flex-col transition-opacity ${leftRefreshing ? 'opacity-40' : 'opacity-100'}`} aria-busy={leftRefreshing}>
                {leftView === 'class'
                  ? <HorizontalBarChart data={productClassBars} label="BGCs by product" className="flex-1" fill />
                  : <HorizontalBarChart data={classBars} label="BGCs by product category" className="flex-1" fill />}
              </div>
            )}
          </CardContent>
          <Legend />
        </Card>}

        {showEcosystem && <Card className="grow">
          {/* Stacked below `sm`: the title and the select do not fit side by side on a phone. */}
          <CardHeader className="flex min-h-9 flex-col items-start gap-2 space-y-0 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="min-w-0 sm:whitespace-nowrap">{distributionTitleMap[pendingGroupBy]()}</CardTitle>
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <Loader2
                aria-hidden={!refreshing}
                className={`size-3.5 shrink-0 animate-spin text-muted-foreground transition-opacity ${
                  refreshing ? 'opacity-100' : 'opacity-0'
                }`}
              />
              <Select value={pendingGroupBy} onValueChange={(v) => handleGroupByChange(v as GroupByOption)}>
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {groupByOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          {ecosystemCoverage && <div className="-mt-2 px-6 pb-3 text-xs text-muted-foreground">{ecosystemCoverage}</div>}
          <CardContent className="flex flex-1 flex-col">
            <div className={`flex flex-1 flex-col transition-opacity ${refreshing ? 'opacity-40' : 'opacity-100'}`} aria-busy={refreshing}>
              <HorizontalBarChart data={distributionBars} label="BGCs by GOLD ecosystem" className="flex-1" fill />
            </div>
          </CardContent>
          <Legend goldBars={distributionData} />
        </Card>}
    </div>
  );
};
