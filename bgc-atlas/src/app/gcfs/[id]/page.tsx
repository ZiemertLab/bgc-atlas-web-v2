'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MainLayout } from '@/components/layout/main-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Loader2,
  AlertCircle,
  ArrowLeft,
  ExternalLink,
  Database,
  BarChart3,
  Globe,
  Dna,
  MapPin,
  GitBranch,
  Eye,
  ChevronDown,
  ChevronRight,
  Thermometer,
} from 'lucide-react';
import { ApiError } from '@/lib/api-client';
import { useGcfDetail } from '@/lib/hooks/use-gcf-detail';
import { useGcfMapSamples } from '@/lib/hooks/use-gcf-map-samples';
import { useGcfEnvironment } from '@/lib/hooks/use-gcf-environment';
import { ExportGbkButton } from '@/components/gcf/export-gbk-button';
import { ProductTypeChart, GoldEcosystemChart, SourceTypeChart } from '@/components/charts/gcf-detail-charts';
import { TaxonomyDistributionChart } from '@/components/charts/taxonomy-distribution-chart';
import { TaxonomySummaryCards } from '@/components/charts/taxonomy-summary-cards';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { CollapsibleSection } from '@/components/ui/collapsible-section';
import { SampleMapDots } from '@/components/ui/sample-map-dots';
import { getProductCategoryBadgeStyle, getProductCategoryColor } from '@/lib/utils/chart-utils';
import { ProductCategoryChart } from '@/components/ui/product-category-chart';
import { splitCombination } from '@/lib/gcf/category-share';
import { formatBgcLength, formatKb } from '@/lib/utils/bgc-length';
import { BgcTable } from '@/components/tables/bgc-table';
import { BgcRegionViewer } from '@/components/charts/bgc-viewer/bgc-region-viewer';
import { CopyLinkButton } from '@/components/ui/copy-link-button';
import { GcfEnvironmentPanel } from '@/components/gcf/gcf-environment-panel';
import { FragmentedBadge } from '@/components/ui/fragmented-badge';
import { TooltipBadge } from '@/components/ui/tooltip-badge';
import { MibigAnchorChip, MibigAnchorsPanel } from './gcf-mibig-anchors';
import { RetiredFamilyView } from '@/components/gcf/retired-family';
import type { RetiredFamily } from '@/lib/gcf-legacy';

function retiredFrom(body: string | undefined): RetiredFamily | null {
  try {
    const parsed = JSON.parse(body ?? '') as { retired?: RetiredFamily };
    return parsed.retired ?? null;
  } catch {
    return null;
  }
}

export default function GcfDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: gcf, isLoading, error, hasLoaded } = useGcfDetail(id);
  const { data: mapData, isLoading: mapLoading, error: mapError } = useGcfMapSamples(id);
  // Fetched with the page, not on panel open: whether the section renders at all depends on the response.
  const {
    fields: envFields,
    totalSamples: envTotalSamples,
    isLoading: envLoading,
  } = useGcfEnvironment(id);
  const [mounted, setMounted] = useState(false);
  const [showRepViewer, setShowRepViewer] = useState(false);

  useState(() => {
    setMounted(true);
  });

  if (!mounted || (isLoading && !hasLoaded)) {
    return (
      <MainLayout>
        <div className="mx-auto w-full max-w-[1400px] py-8">
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        </div>
      </MainLayout>
    );
  }

  // 400 is only emitted for a non-UUID id (e.g. a pasted family name), so it is a dead address too.
  // Anything else falls through: an unreachable database must not read as "no such family".
  if (error instanceof ApiError && (error.status === 404 || error.status === 400)) {
    notFound();
  }

  // A family of a replaced clustering: the API answers 410 with where its members went.
  if (error instanceof ApiError && error.status === 410) {
    const retired = retiredFrom(error.body);
    if (retired) return <RetiredFamilyView family={retired} />;
    notFound();
  }

  if (error || !gcf) {
    return (
      <MainLayout>
        <div className="mx-auto w-full max-w-[1400px] py-8">
          <div className="py-12 text-center">
            <AlertCircle className="mx-auto h-12 w-12 text-destructive mb-4" />
            <h3 className="text-lg font-semibold mb-2">Failed to load GCF</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {error?.message || 'Unable to load this family right now.'}
            </p>
            <Link href="/gcfs">
              <Button>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to GCFs
              </Button>
            </Link>
          </div>
        </div>
      </MainLayout>
    );
  }

  // Below the rounding floor say "<1%" rather than "0%", and give the raw counts in a tooltip.
  const completenessFraction = gcf.memberBgcCount > 0
    ? (gcf.completeBgcCount / gcf.memberBgcCount) * 100
    : 0;
  const completenessLabel = completenessFraction > 0 && completenessFraction < 0.5
    ? '<1%'
    : `${Math.round(completenessFraction)}%`;
  const completenessTitle =
    `${gcf.completeBgcCount.toLocaleString()} of ${gcf.memberBgcCount.toLocaleString()} member BGCs are complete`;

  const length = formatBgcLength(gcf.lengthStats);

  // Shares of members. A member can carry several categories, so per-category rows overlap.
  const shareOfMembers = (count: number): string => {
    if (gcf.memberBgcCount <= 0) return '—';
    const pct = (count / gcf.memberBgcCount) * 100;
    // A large family can hold a handful of NRPS members among ~100k.
    return pct > 0 && pct < 0.1 ? '<0.1%' : `${pct.toFixed(1)}%`;
  };
  const categoryMembers = gcf.categoryMembers ?? [];
  const categoryCombinations = gcf.categoryCombinations ?? [];
  const hybridMemberCount = categoryCombinations
    .filter((c) => splitCombination(c.combination) !== null)
    .reduce((sum, c) => sum + c.bgcCount, 0);
  const showCombinations = categoryCombinations.length > 1 || hybridMemberCount > 0;
  const combinationShares = Object.fromEntries(
    categoryCombinations.map((c) => [
      c.combination,
      gcf.memberBgcCount > 0 ? (c.bgcCount / gcf.memberBgcCount) * 100 : 0,
    ]),
  );
  const productAssignments = gcf.productTypeDistribution.reduce((sum, p) => sum + p.bgcCount, 0);


  return (
    <MainLayout>
      <TooltipProvider>
        <div className="mx-auto w-full max-w-[1400px] py-8">
        <header className="mb-6 border-b border-border pb-4">
          <div className="section-label mb-1.5">Gene cluster family</div>
          {/* atlas-rule sits on the wrapper: on the shrink-wrapped h1 its ::after would truncate
              and, once the alias wraps, draw between the name and the alias. */}
          <div className="atlas-rule mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="font-mono text-2xl font-semibold tracking-tight md:text-3xl">
              {gcf.name}
            </h1>
            {gcf.petName && (
              // The sr-only prefix is the accessible name: aria-label on a bare span is dropped,
              // and `title` is mouse-only.
              <span
                className="font-mono text-lg font-semibold text-muted-foreground md:text-xl"
                title="Human-readable alias — for recall only, not an identifier"
              >
                <span className="sr-only">Alias: </span>
                {gcf.petName}
              </span>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <TooltipBadge variant="outline" className="font-mono" tooltip={`GCF ID: ${gcf.id}`}>
              {gcf.id}
            </TooltipBadge>
            {gcf.familyClass === 'fragmented' && <FragmentedBadge trigger="hover" />}
            <MibigAnchorChip anchors={gcf.mibigAnchors ?? []} />
          </div>
          {gcf.description && (
            <p className="mt-3 max-w-3xl text-[14px] leading-relaxed text-muted-foreground">{gcf.description}</p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Link href="/gcfs">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="size-3.5" />
                Back to GCFs
              </Button>
            </Link>
            <ExportGbkButton gcfId={gcf.id} gcfName={gcf.name || gcf.id} memberCount={gcf.memberBgcCount} />
            <CopyLinkButton className="ml-auto" />
          </div>
        </header>

        <section className="mb-6 border-b border-border pb-4">
          <div className="section-label mb-2.5">Summary</div>
          {/* 4-up below lg, where a fifth column would crush the leader dots. */}
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4 lg:grid-cols-5">
            <div className="leader-row">
              <dt className="whitespace-nowrap text-muted-foreground">Member BGCs</dt>
              <span className="leader-dots" aria-hidden />
              <dd className="font-mono font-medium tabular-nums text-foreground">
                <Link href={`/bgcs?gcf=${gcf.id}`} className="underline-offset-4 hover:underline">
                  {gcf.memberBgcCount.toLocaleString()}
                </Link>
              </dd>
            </div>
            <div className="leader-row">
              <dt className="whitespace-nowrap text-muted-foreground">Assemblies</dt>
              <span className="leader-dots" aria-hidden />
              <dd className="font-mono font-medium tabular-nums text-foreground">
                {gcf.assemblyCount.toLocaleString()}
              </dd>
            </div>
            <div className="leader-row">
              <dt className="whitespace-nowrap text-muted-foreground">Completeness</dt>
              <span className="leader-dots" aria-hidden />
              <dd className="font-mono font-medium tabular-nums text-foreground">
                <span title={completenessTitle}>{completenessLabel}</span>
              </dd>
            </div>
            <div className="leader-row">
              <dt className="whitespace-nowrap text-muted-foreground">Unique taxa</dt>
              <span className="leader-dots" aria-hidden />
              <dd className="font-mono font-medium tabular-nums text-foreground">
                {gcf.uniqueTaxaCount.toLocaleString()}
              </dd>
            </div>
            <div className="leader-row">
              <dt className="whitespace-nowrap text-muted-foreground">Length</dt>
              <span className="leader-dots" aria-hidden />
              <dd
                className={`font-mono font-medium tabular-nums ${length?.isBound ? 'text-muted-foreground' : 'text-foreground'}`}
                title={length?.tooltip}
              >
                {length?.text ?? '—'}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-muted-foreground tabular-nums">
            {gcf.completeBgcCount.toLocaleString()} complete · {gcf.partialBgcCount.toLocaleString()} partial
          </p>
        </section>

        <div className="mb-6 space-y-3">
          <CollapsibleSection title="Distance distribution" defaultOpen={false}>
            <p className="mb-3 text-xs text-muted-foreground">
              BiG-SLiCE distance of member BGCs to this family (lower = more similar).
            </p>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
              {[
                ['Average', gcf.avgDistance],
                ['Median', gcf.medianDistance],
                ['Min', gcf.minDistance],
                ['Max', gcf.maxDistance],
              ].map(([label, value]) => (
                <div key={label as string} className="leader-row">
                  <dt className="whitespace-nowrap text-muted-foreground">{label as string}</dt>
                  <span className="leader-dots" aria-hidden />
                  <dd className="font-mono tabular-nums text-foreground">
                    {(value as number | null | undefined)?.toFixed(3) ?? '—'}
                  </dd>
                </div>
              ))}
            </dl>
          </CollapsibleSection>

          <CollapsibleSection title="Length distribution" defaultOpen={false}>
            {gcf.lengthStats ? (
              <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
                <div className="leader-row">
                  <dt className="whitespace-nowrap text-muted-foreground">
                    {/* Not 'Longest member': the max field two columns over already uses that label. */}
                    {gcf.lengthStats.completeCount > 0 ? 'Median (complete)' : 'Lower bound'}
                  </dt>
                  <span className="leader-dots" aria-hidden />
                  <dd className="font-mono tabular-nums text-foreground">{length?.text ?? '—'}</dd>
                </div>
                <div className="leader-row">
                  <dt className="whitespace-nowrap text-muted-foreground">Shortest member</dt>
                  <span className="leader-dots" aria-hidden />
                  <dd className="font-mono tabular-nums text-foreground">{formatKb(gcf.lengthStats.minLen)}</dd>
                </div>
                <div className="leader-row">
                  <dt className="whitespace-nowrap text-muted-foreground">Longest member</dt>
                  <span className="leader-dots" aria-hidden />
                  <dd className="font-mono tabular-nums text-foreground">{formatKb(gcf.lengthStats.maxLen)}</dd>
                </div>
                <div className="leader-row">
                  <dt className="whitespace-nowrap text-muted-foreground">Complete members</dt>
                  <span className="leader-dots" aria-hidden />
                  <dd className="font-mono tabular-nums text-foreground">
                    {gcf.lengthStats.completeCount.toLocaleString()} of{' '}
                    {gcf.lengthStats.memberCount.toLocaleString()}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">No length data for this family.</p>
            )}
            {gcf.lengthStats?.completeCount === 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                No member of this family is complete, so the headline figure is the longest
                member observed — a lower bound on the cluster&rsquo;s true length, not an estimate.
              </p>
            )}
          </CollapsibleSection>

          {/* Seed tier only: route is almost determined by family_class, so elsewhere the panel
              would be one row at 100%. Derived is split because contained and orphan_query differ. */}
          {gcf.familyClass === 'seed'
            && (gcf.containedAssignments ?? 0) + (gcf.orphanQueryAssignments ?? 0) > 0 && (
            <CollapsibleSection title="Assignment statistics" defaultOpen={false}>
              <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
                {([
                  ['Seed', gcf.seedAssignments, 'Defined this family: truncation-clean members of the seed set.'],
                  ['Contained', gcf.containedAssignments ?? 0, 'Folded in because the region is contained within an existing family member.'],
                  ['Orphan query', gcf.orphanQueryAssignments ?? 0, 'Matched to this family as a query after landing in none by containment.'],
                ] as const).map(([label, value, title]) => (
                  <div key={label} className="leader-row" title={title}>
                    <dt className="whitespace-nowrap text-muted-foreground">{label}</dt>
                    <span className="leader-dots" aria-hidden />
                    <dd className="font-mono tabular-nums text-foreground">
                      {value.toLocaleString()}
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        {gcf.memberBgcCount > 0
                          ? Math.round((value / gcf.memberBgcCount) * 100)
                          : 0}
                        %
                      </span>
                    </dd>
                  </div>
                ))}
                <div className="leader-row">
                  <dt className="whitespace-nowrap text-muted-foreground">Total BGCs</dt>
                  <span className="leader-dots" aria-hidden />
                  <dd className="font-mono tabular-nums text-foreground">
                    {gcf.memberBgcCount.toLocaleString()}
                  </dd>
                </div>
              </dl>
            </CollapsibleSection>
          )}
        </div>

        {gcf.representativeBgc && (
          <section className="mb-6 border border-border bg-card px-4 py-4">
            <div className="mb-2 flex items-baseline gap-2">
              <span className="section-label">Representative BGC</span>
            </div>
            {/* min-w-0 on the grid items: a long unbreakable value would otherwise widen the page at 390px. */}
            <dl className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm md:grid-cols-2 [&>div]:min-w-0">
              <div>
                <dt className="text-xs text-muted-foreground">BGC ID</dt>
                <dd className="mt-0.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Link
                        href={`/bgcs/${encodeURIComponent(gcf.representativeBgc.id)}`}
                        className="inline-flex items-center gap-1 font-mono text-sm text-foreground underline-offset-4 hover:underline"
                      >
                        {gcf.representativeBgc.id.slice(0, 16)}…
                        <ExternalLink className="size-3" />
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="font-mono">{gcf.representativeBgc.id}</p>
                    </TooltipContent>
                  </Tooltip>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Name</dt>
                <dd className="mt-0.5 font-medium break-words text-foreground">
                  {gcf.representativeBgc.name}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Categories</dt>
                <dd className="mt-1 flex flex-wrap gap-1">
                  {gcf.representativeBgc.productCategory.map((cat) => (
                    <Badge key={cat} variant="outline" className="gap-1">
                      <span
                        aria-hidden
                        className="inline-block size-1.5 rounded-full"
                        style={{ backgroundColor: getProductCategoryBadgeStyle(cat)?.backgroundColor as string | undefined }}
                      />
                      {cat}
                    </Badge>
                  ))}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Completeness</dt>
                <dd className="mt-1">
                  <TooltipBadge
                    variant={gcf.representativeBgc.isComplete ? 'solid' : 'outline'}
                    tooltip={
                      gcf.representativeBgc.isComplete
                        ? 'BGC contains all required genes and is fully characterised'
                        : 'BGC is incomplete or partially characterised'
                    }
                  >
                    {gcf.representativeBgc.isComplete ? 'Complete' : 'Partial'}
                  </TooltipBadge>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Length</dt>
                <dd className="mt-0.5 font-mono tabular-nums text-foreground">
                  {gcf.representativeBgc.length.toLocaleString()} bp
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Genes</dt>
                <dd className="mt-0.5 font-mono tabular-nums text-foreground">
                  {gcf.representativeBgc.genes?.toLocaleString() ?? '—'}
                </dd>
              </div>
            </dl>

            {/* Without an anchor the viewer falls back to the first region on the contig, which on a
                multi-region contig is a different BGC; no viewer beats a wrong one. */}
            {gcf.representativeBgc.anchor && (
              <div className="mt-4 border-t border-border pt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowRepViewer((open) => !open)}
                  aria-expanded={showRepViewer}
                >
                  {showRepViewer ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                  <Eye className="size-4" />
                  {showRepViewer ? 'Hide BGC View' : 'Show BGC View'}
                </Button>

                {showRepViewer && (
                  <div className="mt-3">
                    <BgcRegionViewer bgcId={gcf.representativeBgc.id} />
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {(gcf.mibigAnchors?.length ?? 0) > 0 && (
          <div className="mb-6">
            <MibigAnchorsPanel anchors={gcf.mibigAnchors ?? []} />
          </div>
        )}

        <CollapsibleSection
          title="Category distribution"
          icon={BarChart3}
          badge={gcf.uniqueProductCategories?.toLocaleString()}
          defaultOpen={true}
          className="mb-6"
        >
          {categoryMembers.length > 0 && (
            <div className="mb-6">
              <div className="section-label mb-2.5">Members carrying each category</div>
              {/* One column on phones: a nowrap label in a half-width item overflows 390px. */}
              <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                {categoryMembers.map(({ category, bgcCount }) => (
                  <div key={category} className="leader-row">
                    <dt className="flex items-center gap-1.5 whitespace-nowrap text-muted-foreground">
                      <span
                        aria-hidden
                        className="inline-block size-2.5 border border-border"
                        style={{ backgroundColor: getProductCategoryColor(category) }}
                      />
                      {category}
                    </dt>
                    <span className="leader-dots" aria-hidden />
                    <dd className="font-mono font-medium tabular-nums text-foreground">
                      {bgcCount.toLocaleString()}
                      <span className="text-muted-foreground"> · {shareOfMembers(bgcCount)}</span>
                    </dd>
                  </div>
                ))}
              </dl>
              {hybridMemberCount > 0 && (
                <p className="mt-2 text-xs text-muted-foreground tabular-nums">
                  {hybridMemberCount.toLocaleString()} members ({shareOfMembers(hybridMemberCount)}) carry
                  more than one category, so these rows overlap and add up to more than the{' '}
                  {gcf.memberBgcCount.toLocaleString()} member BGCs.
                </p>
              )}
            </div>
          )}
          {showCombinations && (
            <div className="mb-6">
              <div className="section-label mb-2.5">Members by exact combination</div>
              <ProductCategoryChart distribution={combinationShares} height={28} valueLabel="of members" />
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {categoryCombinations.map(({ combination, bgcCount }) => (
                  <li key={combination} className="font-mono tabular-nums">
                    <span className="text-foreground">{combination}</span>{' '}
                    {bgcCount.toLocaleString()} ({shareOfMembers(bgcCount)})
                  </li>
                ))}
              </ul>
            </div>
          )}
          {gcf.productTypeDistribution.length > 0 ? (
            <div className="w-full">
              <div className="section-label mb-1.5">Products</div>
              <p className="mb-3 text-xs text-muted-foreground tabular-nums">
                {productAssignments.toLocaleString()} product assignments across{' '}
                {gcf.memberBgcCount.toLocaleString()} member BGCs: a BGC with several antiSMASH
                products counts once for each.
              </p>
              <ProductTypeChart
                data={gcf.productTypeDistribution.map(item => ({
                  ...item,
                  percentage: (item.bgcCount / gcf.memberBgcCount) * 100
                }))}
                width={700}
                height={500}
              />
            </div>
          ) : (
            <div className="text-center text-sm text-muted-foreground py-4">
              No product data available
            </div>
          )}
        </CollapsibleSection>

        <CollapsibleSection
          title="GOLD Ecosystem Distribution"
          icon={Globe}
          defaultOpen={false}
          className="mb-6"
        >
          <div className="w-full">
            <GoldEcosystemChart gcfId={id} width={700} height={450} />
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          title="Taxonomy Distribution"
          icon={GitBranch}
          defaultOpen={false}
          className="mb-6"
        >
          <TaxonomySummaryCards gcfId={gcf.id} />

          <TaxonomyDistributionChart gcfId={gcf.id} />
        </CollapsibleSection>

        <CollapsibleSection
          title="Geographic Distribution"
          icon={MapPin}
          badge={mapData?.total?.toLocaleString()}
          defaultOpen={false}
          className="mb-6"
        >
          {mapLoading ? (
            <div className="flex h-[520px] items-center justify-center border border-border bg-card text-sm text-muted-foreground">
              Loading map…
            </div>
          ) : mapError ? (
            <div className="flex h-[520px] items-center justify-center border border-border bg-card text-sm text-destructive">
              Failed to load map
            </div>
          ) : (
            <SampleMapDots samples={mapData?.data || []} height={520} />
          )}
          {mapData && mapData.total > 5000 && (
            <div className="text-xs text-muted-foreground text-center mt-4">
              Showing 5,000 of {mapData.total.toLocaleString()} samples with coordinates
            </div>
          )}
        </CollapsibleSection>

        {envFields.length > 0 && (
          <CollapsibleSection
            title="Environmental Measurements"
            icon={Thermometer}
            badge={envFields.length.toLocaleString()}
            defaultOpen={false}
            className="mb-6"
          >
            <GcfEnvironmentPanel
              fields={envFields}
              totalSamples={envTotalSamples}
              isLoading={envLoading}
            />
          </CollapsibleSection>
        )}

        <CollapsibleSection
          title="Assembly Source Type Distribution"
          icon={Database}
          defaultOpen={false}
          className="mb-6"
        >
          {gcf.sourceTypeDistribution.length > 0 ? (
            <div className="flex justify-center w-full">
              <SourceTypeChart
                data={gcf.sourceTypeDistribution}
                width={600}
                height={400}
              />
            </div>
          ) : (
            <div className="text-center text-sm text-muted-foreground py-4">
              No source type distribution data available
            </div>
          )}
        </CollapsibleSection>

        <CollapsibleSection
          title="Member BGCs"
          icon={Dna}
          badge={gcf.memberBgcCount?.toLocaleString()}
          defaultOpen={false}
          className="mb-6"
        >
          <BgcTable
            preFilters={{ gcf: gcf.id }}
            config={{
              showGlobalSearch: true,
              showProductClassFilter: true,
              showExportButtons: true,
              showFilterChips: true,
              enableUrlSync: false,
              enableTour: false,
            }}
            paginationConfig={{
              defaultPageSize: 50,
            }}
          />
        </CollapsibleSection>
        </div>
      </TooltipProvider>
    </MainLayout>
  );
}
