'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { notFound, useParams } from 'next/navigation';
import { ArrowLeft, ArrowUpRight, BarChart3, ExternalLink, FileText, Globe, Layers, Loader2, TestTube } from 'lucide-react';

import { MainLayout } from '@/components/layout/main-layout';
import { CollapsibleSection } from '@/components/ui/collapsible-section';
import { Pagination } from '@/components/ui/pagination';
import { ResizableTable, type TableColumn } from '@/components/ui/resizable-table';
import { CopyLinkButton } from '@/components/ui/copy-link-button';
import {
  AbstractCredit,
  AbstractUnavailable,
  hasAbstractContent,
  showsAbstractText,
} from '@/components/ui/abstract-credit';
import { SampleMapDots } from '@/components/ui/sample-map-dots';
import { StudyProductStrip } from '@/components/ui/study-product-strip';
import { Badge } from '@/components/ui/badge';
import { SampleGcfCount, SAMPLE_GCF_HEADER_TOOLTIP } from '@/components/ui/sample-gcf-count';
import { ApiError } from '@/lib/api-client';
import { useStudy } from '@/lib/hooks/use-studies';
import { useGcfs, type GcfListItem } from '@/lib/hooks/use-gcfs';
import { useSamples } from '@/lib/hooks/use-samples';
import { useStudyBgcCounts } from '@/lib/hooks/use-study-gcfs';
import { studySamplesHref } from '@/lib/utils/sample-link';
import type { Sample } from '@/lib/types';
import { bioprojectUrl, doiUrl, isBioProject, isDoi, pubmedUrl, showStudyKey } from '@/lib/utils/accession';
import { formatGOLDBreadcrumb, getGOLDBadgeClass, getGOLDColorHex } from '@/lib/utils/gold-parser';
import { BiomeDistributionChart } from '@/components/ui/biome-distribution-chart';
import { ProductCategoryChart } from '@/components/ui/product-category-chart';
import { TaxonomyDistributionChart } from '@/components/ui/taxonomy-distribution-chart';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { formatBgcLength } from '@/lib/utils/bgc-length';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SampleDataSourceLinks } from '@/components/ui/sample-data-source-links';

const num = (n: number | null | undefined) => (n ?? 0).toLocaleString();

function Leader({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="leader-row">
      <dt className="whitespace-nowrap text-muted-foreground">{label}</dt>
      <span className="leader-dots" aria-hidden />
      <dd className="font-mono font-medium tabular-nums text-foreground">{children}</dd>
    </div>
  );
}

export default function StudyDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const { data, isLoading, error } = useStudy(id);
  const detail = data.data;

  const [samplePage, setSamplePage] = useState(0);
  const [samplePageSize, setSamplePageSize] = useState(25);
  const [sampleSortField, setSampleSortField] = useState('bgcs');
  const [sampleSortOrder, setSampleSortOrder] = useState<'asc' | 'desc'>('desc');
  const [sampleColVisibility, setSampleColVisibility] = useState<Record<string, boolean>>({});
  const [sampleColWidths, setSampleColWidths] = useState<Record<string, number>>({});
  const [exclusiveOnly, setExclusiveOnly] = useState(true);
  const [gcfPage, setGcfPage] = useState(0);
  const [gcfPageSize, setGcfPageSize] = useState(50);
  const [gcfSortField, setGcfSortField] = useState('members');
  const [gcfSortOrder, setGcfSortOrder] = useState<'asc' | 'desc'>('desc');
  const [gcfColVisibility, setGcfColVisibility] = useState<Record<string, boolean>>({});
  const [gcfColWidths, setGcfColWidths] = useState<Record<string, number>>({});
  const [ecosystemLevel, setEcosystemLevel] = useState(1);
  // Phylum, not domain: within one study nearly every family is d__Bacteria.
  const [taxonomyRank, setTaxonomyRank] = useState<string>('phylum');

  // A study with no exclusive families would otherwise open on an empty tab.
  const showExclusive = exclusiveOnly && (detail?.metrics.exclusive_gcfs ?? 0) > 0;

  // The /gcfs hook and endpoint, narrowed by study_key (study_keys lives on gcf_browse).
  const {
    data: gcfResponse,
    isLoading: gcfsLoading,
  } = useGcfs({
    study: detail?.study.study_key,
    exclusive: showExclusive,
    limit: gcfPageSize,
    offset: gcfPage * gcfPageSize,
    sortField: gcfSortField,
    sortOrder: gcfSortOrder,
    enabled: !!detail?.study.study_key,
  });
  const gcfRows = gcfResponse.data?.data ?? [];
  const gcfTotal = gcfResponse.data?.total ?? 0;

  // From the index the table pages: the summary's distinct_gcfs also counts
  // fragmented singletons /gcfs does not list. limit 1, only `total` is wanted.
  const { data: otherGcfResponse } = useGcfs({
    study: detail?.study.study_key,
    exclusive: !showExclusive,
    limit: 1,
    enabled: !!detail?.study.study_key,
  });
  const otherTotal = otherGcfResponse.data?.total ?? 0;
  const exclusiveTotal = showExclusive ? gcfTotal : otherTotal;
  const allTotal = showExclusive ? otherTotal : gcfTotal;

  // ?studyKey= is the exact study; titles are shared by several studies.
  const { data: sampleResponse, isLoading: samplesLoading } = useSamples({
    studyKey: detail?.study.study_key,
    limit: samplePageSize,
    offset: samplePage * samplePageSize,
    sortField: sampleSortField,
    sortOrder: sampleSortOrder,
    enabled: !!detail?.study.study_key,
  });
  const sampleRows = sampleResponse.data?.data ?? [];
  const sampleTotal = sampleResponse.data?.total ?? 0;

  // /samples shows metagenomes and /genome-collections isolates, MAGs and SAGs, so
  // the table link must know which side the samples are on. Counted per side, since
  // one sample can carry more than one source type. limit 1: only `total` is wanted.
  const { data: metagenomeCountResponse, hasLoaded: metagenomeCountLoaded } = useSamples({
    studyKey: detail?.study.study_key,
    sourceType: 'metagenome',
    limit: 1,
    enabled: !!detail?.study.study_key,
  });
  const { data: genomeCountResponse, hasLoaded: genomeCountLoaded } = useSamples({
    studyKey: detail?.study.study_key,
    sourceType: ['isolate', 'MAG', 'SAG'],
    limit: 1,
    enabled: !!detail?.study.study_key,
  });
  const metagenomeTotal = metagenomeCountResponse.data?.total ?? 0;
  const genomeTotal = genomeCountResponse.data?.total ?? 0;
  const sourceSplitLoaded = metagenomeCountLoaded && genomeCountLoaded;

  const sampleColumns = useMemo<TableColumn<Sample>[]>(
    () => [
      {
        id: 'id', label: 'Sample', width: sampleColWidths.id ?? 190, sortable: true,
        visible: sampleColVisibility.id !== false,
        renderCell: (s: Sample) => (
          <Link
            href={`/samples/${s.id}`}
            className="block truncate font-mono text-xs text-brand hover:underline"
            title={s.externalId || s.id}
          >
            {s.externalId || s.id}
          </Link>
        ),
      },
      {
        id: 'gcfs', label: '# GCFs', width: sampleColWidths.gcfs ?? 110, sortable: true,
        defaultSortDirection: 'desc',
        headerTooltip: SAMPLE_GCF_HEADER_TOOLTIP,
        visible: sampleColVisibility.gcfs !== false, className: 'text-center',
        renderCell: (s: Sample) => <SampleGcfCount sample={s} />,
      },
      {
        id: 'bgcs', label: '# BGCs', width: sampleColWidths.bgcs ?? 110, sortable: true,
        defaultSortDirection: 'desc',
        visible: sampleColVisibility.bgcs !== false, className: 'text-center',
        renderCell: (s: Sample) =>
          (s.bgcCount ?? 0) > 0 ? (
            <Link
              href={`/bgcs?sampleId=${s.id}`}
              className="font-medium tabular-nums text-foreground underline decoration-foreground/50 underline-offset-2 hover:decoration-foreground"
            >
              {s.bgcCount?.toLocaleString()}
            </Link>
          ) : (
            <span className="font-medium tabular-nums text-muted-foreground">{(s.bgcCount ?? 0).toLocaleString()}</span>
          ),
      },
      {
        id: 'location', label: 'Location', width: sampleColWidths.location ?? 200, sortable: true,
        visible: sampleColVisibility.location !== false,
        renderCell: (s: Sample) => (
          <span className="block truncate text-sm" title={s.location}>{s.location || '—'}</span>
        ),
      },
      {
        id: 'goldEcosystem', label: 'GOLD Ecosystem', width: sampleColWidths.goldEcosystem ?? 240,
        sortable: false, visible: sampleColVisibility.goldEcosystem !== false,
        renderCell: (s: Sample) =>
          s.goldEcosystemPath ? (
            <Badge
              variant="secondary"
              className={`h-auto max-w-full whitespace-normal text-xs ${getGOLDBadgeClass(s.goldEcosystemPath)}`}
              title={s.goldEcosystemPath}
            >
              {formatGOLDBreadcrumb(s.goldEcosystemPath)}
            </Badge>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          ),
      },
      // Default-hidden: CollapsibleSection padding costs ~120px of column budget.
      {
        id: 'biome', label: 'Biome', width: sampleColWidths.biome ?? 170, sortable: false,
        visible: sampleColVisibility.biome === true,
        renderCell: (s: Sample) => (
          <span className="block truncate text-sm text-muted-foreground" title={s.primaryBiome ?? undefined}>
            {s.primaryBiome || '—'}
          </span>
        ),
      },
      {
        id: 'sourceType', label: 'Source type', width: sampleColWidths.sourceType ?? 130, sortable: false,
        visible: sampleColVisibility.sourceType === true,
        renderCell: (s: Sample) => (
          <span className="text-sm text-muted-foreground">{s.sourceTypes?.join(', ') || '—'}</span>
        ),
      },
      {
        id: 'assemblies', label: '# Assemblies', width: sampleColWidths.assemblies ?? 120, sortable: true,
        defaultSortDirection: 'desc',
        visible: sampleColVisibility.assemblies === true, className: 'text-center',
        renderCell: (s: Sample) => (
          <span className="font-medium tabular-nums">{s.assemblyCount ?? 0}</span>
        ),
      },
      {
        id: 'dataSource', label: 'Data source', width: sampleColWidths.dataSource ?? 170, sortable: false,
        visible: sampleColVisibility.dataSource === true,
        renderCell: (s: Sample) => (
          <SampleDataSourceLinks names={s.dataSourceNames} externalId={s.externalId} />
        ),
      },
    ],
    [sampleColWidths, sampleColVisibility]
  );

  // bgcs_in_study is pair-specific, so it cannot live on a GCF document; merged in
  // per visible page, hence not sortable.
  const { counts: bgcsInStudy } = useStudyBgcCounts(
    detail?.study.study_key,
    gcfRows.map((g) => g.id)
  );

  const mapSamples = useMemo(
    () =>
      (detail?.geography.points ?? []).map((p) => ({
        id: p.id,
        externalId: p.external_id,
        name: p.name,
        location: null,
        latitude: p.latitude ?? undefined,
        longitude: p.longitude ?? undefined,
        environmentBiome: p.primary_biome,
        goldEcosystemPath: p.gold_ecosystem_path,
        environmentMaterial: null,
        environmentFeature: null,
        hostScientificName: null,
        dataSourceNames: [] as string[],
        studyTitles: detail?.study.title ? [detail.study.title] : [],
        sourceTypes: [] as string[],
        assemblyCount: 0,
        bgcCount: p.bgc_count ?? 0,
      })),
    [detail]
  );

  const gcfColumns: TableColumn<GcfListItem>[] = useMemo(
    () => [
      {
        id: 'id', label: 'GCF ID', width: gcfColWidths.id ?? 120, sortable: true,
        visible: gcfColVisibility.id !== false,
        renderCell: (g) => (
          <Link
            href={`/gcfs/${g.id}`}
            className="inline-flex items-center gap-0.5 font-mono text-xs underline decoration-foreground/50 underline-offset-2 hover:decoration-foreground"
          >
            {g.id.slice(0, 8)}…
            <ArrowUpRight className="h-3 w-3" aria-hidden />
          </Link>
        ),
      },
      {
        id: 'name', label: 'Name', width: gcfColWidths.name ?? 165, sortable: true,
        visible: gcfColVisibility.name !== false,
        renderCell: (g) => <span className="truncate font-mono text-sm">{g.name}</span>,
      },
      {
        id: 'petName', label: 'Alias', width: gcfColWidths.petName ?? 140, sortable: true,
        visible: gcfColVisibility.petName !== false,
        renderCell: (g) =>
          g.petName ? <span className="truncate">{g.petName}</span>
                    : <span className="text-xs text-muted-foreground">—</span>,
      },
      {
        id: 'members', label: 'Member BGCs', width: gcfColWidths.members ?? 130, sortable: true,
        defaultSortDirection: 'desc',
        visible: gcfColVisibility.members === true, className: 'text-right',
        headerTooltip: 'BGCs in this family across the whole Atlas.',
        renderCell: (g) => <span className="font-mono tabular-nums">{num(g.memberBgcCount)}</span>,
      },
      {
        id: 'bgcsInStudy', label: 'BGCs in study', width: gcfColWidths.bgcsInStudy ?? 130,
        sortable: false, visible: gcfColVisibility.bgcsInStudy !== false, className: 'text-right',
        headerTooltip:
          'BGCs from THIS study in the family. A property of the study/family pair, so it is display-only — sorting is done by the families index, which cannot see it.',
        renderCell: (g) => (
          <span className="font-mono tabular-nums">
            {bgcsInStudy[g.id] === undefined ? '·' : num(bgcsInStudy[g.id])}
          </span>
        ),
      },
      {
        id: 'productCategories', label: 'Category distribution',
        width: gcfColWidths.productCategories ?? 240, sortable: false,
        visible: gcfColVisibility.productCategories !== false,
        renderCell: (g) =>
          Object.keys(g.productCategoryDistribution ?? {}).length === 0 ? (
            <span className="text-xs text-muted-foreground">None</span>
          ) : (
            <div className="w-full px-1">
              <ProductCategoryChart distribution={g.productCategoryDistribution} height={24} valueLabel="of members" />
            </div>
          ),
      },
      {
        id: 'taxonomy', label: 'Taxonomy',
        width: gcfColWidths.taxonomy ?? 240, sortable: false,
        visible: gcfColVisibility.taxonomy !== false,
        renderHeader: () => (
          <div className="flex items-center gap-1">
            <span>Taxonomy</span>
            <Select value={taxonomyRank} onValueChange={setTaxonomyRank}>
              <SelectTrigger className="h-6 w-auto min-w-20 px-2 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {['domain', 'phylum', 'class', 'order', 'family', 'genus', 'species'].map((r) => (
                  <SelectItem key={r} value={r}>
                    {r[0].toUpperCase() + r.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <InfoTooltip content="Distribution of member BGCs across the selected GTDB taxonomy rank." />
          </div>
        ),
        renderCell: (g) => {
          const byRank = { ...(g.taxonomyDistributionByRank ?? {}) } as Record<string, Record<string, number>>;
          // Same fallback as /gcfs: domain comes from taxonomyDistribution when the
          // per-rank map has none.
          if (!byRank.domain?.length && Object.keys(g.taxonomyDistribution ?? {}).length) {
            byRank.domain = g.taxonomyDistribution;
          }
          const dist = byRank[taxonomyRank];
          return dist && Object.keys(dist).length ? (
            <div className="w-full px-1">
              <TaxonomyDistributionChart distribution={dist} height={24} />
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">No data</span>
          );
        },
      },
      {
        id: 'ecosystem', label: 'GOLD Ecosystem',
        width: gcfColWidths.ecosystem ?? 240, sortable: false,
        visible: gcfColVisibility.ecosystem !== false,
        headerControl: () => (
          <Select value={String(ecosystemLevel)} onValueChange={(v) => setEcosystemLevel(Number(v))}>
            <SelectTrigger className="h-6 w-16 px-2 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4, 5].map((l) => (
                <SelectItem key={l} value={String(l)}>{`L${l}`}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ),
        headerTooltip: `Distribution of BGCs across GOLD ecosystem level ${ecosystemLevel}.`,
        renderCell: (g) => {
          const dist = g.biomeDistributionByLevel?.[ecosystemLevel] ?? {};
          return Object.keys(dist).length ? (
            <div className="w-full px-1">
              <BiomeDistributionChart distribution={dist} height={24} />
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">No data</span>
          );
        },
      },
      {
        id: 'length', label: 'Length',
        width: gcfColWidths.length ?? 110, minWidth: 90, sortable: true,
        defaultSortDirection: 'desc',
        // Default-hidden to fit the panel width.
        visible: gcfColVisibility.length === true,
        headerTooltip:
          'Median length of the family\u2019s complete member BGCs. ' +
            'Families with no complete member show the longest member observed, prefixed \u2265.',
        renderCell: (g) => {
          const len = formatBgcLength(g.lengthStats);
          if (!len) return <span className="text-xs text-muted-foreground">—</span>;
          return (
            <span
              className={`block text-right tabular-nums ${len.isBound ? 'text-muted-foreground' : 'text-foreground'}`}
              title={len.tooltip}
            >
              {len.text}
            </span>
          );
        },
      },
      {
        // Default-hidden to fit the panel width.
        id: 'assemblies', label: 'Assemblies', width: gcfColWidths.assemblies ?? 130, sortable: true,
        defaultSortDirection: 'desc',
        visible: gcfColVisibility.assemblies === true, className: 'text-right',
        renderCell: (g) => <span className="font-mono tabular-nums">{num(g.assemblyCount)}</span>,
      },
    ],
    [gcfColVisibility, gcfColWidths, bgcsInStudy, ecosystemLevel, taxonomyRank]
  );

  if (isLoading) {
    return (
      <MainLayout>
        <div className="flex w-full items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

  // Only a missing study is a 404; any other empty `detail` is a failure.
  if (error instanceof ApiError && error.status === 404) {
    notFound();
  }

  if (!detail) {
    return (
      <MainLayout>
        <div className="mx-auto w-full max-w-[1400px] py-16 text-center">
          <p className="text-lg text-muted-foreground">Unable to load this study right now.</p>
          <Link href="/studies" className="mt-4 inline-flex items-center gap-1 text-sm text-brand hover:underline">
            <ArrowLeft className="h-4 w-4" /> Back to Studies
          </Link>
        </div>
      </MainLayout>
    );
  }

  const { study, metrics, geography, environment_distribution } = detail;

  const title = study.title || study.study_name || study.study_key;
  const accessions = [...new Set([...study.accessions, ...study.bioprojects])];
  // Some custom studies carry their DOI as the accession.
  const paperDois = study.dois.filter(
    (doi) => !accessions.some((acc) => acc.toLowerCase() === doi.toLowerCase())
  );
  const abstract = study.abstract?.trim() ?? '';
  const unclustered = Math.max(0, metrics.total_bgcs - metrics.clustered_bgcs);
  const coveragePct = metrics.gcf_coverage == null ? null : Math.round(metrics.gcf_coverage * 100);
  // Guards a mid-load allTotal of 0, which would mark every family unlisted.
  const unlistedGcfs = allTotal > 0 ? Math.max(0, metrics.distinct_gcfs - allTotal) : 0;
  const realBiomes = environment_distribution.filter((e) => e.biome && e.biome !== 'Unclassified');
  const envMax = Math.max(1, ...realBiomes.map((e) => e.count));

  return (
    <MainLayout>
      <div className="mx-auto w-full max-w-[1400px] py-8">
        <header className="mb-6">
          <div className="section-label">Study</div>
          <h1 className="text-balance text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            {/* See showStudyKey. */}
            {showStudyKey(study.study_key, { identifiers: accessions, title }) && (
              <span className="rounded border px-2 py-1 font-mono text-muted-foreground">
                {study.study_key}
              </span>
            )}
            {accessions.map((acc) => {
              // Some custom studies carry their DOI as the accession.
              const href = isBioProject(acc) ? bioprojectUrl(acc) : isDoi(acc) ? doiUrl(acc) : null;
              return href ? (
                <a
                  key={acc}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded border px-2 py-1 font-mono text-brand hover:bg-accent"
                >
                  {acc} <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <span key={acc} className="rounded border px-2 py-1 font-mono text-muted-foreground">
                  {acc}
                </span>
              );
            })}
            {paperDois.map((doi) => (
              <a
                key={doi}
                href={doiUrl(doi)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded border px-2 py-1 font-mono text-brand hover:bg-accent"
              >
                doi:{doi} <ExternalLink className="h-3 w-3" />
              </a>
            ))}
            {study.pmids.map((pmid) => (
              <a
                key={pmid}
                href={pubmedUrl(pmid)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded border px-2 py-1 font-mono text-brand hover:bg-accent"
              >
                PMID:{pmid} <ExternalLink className="h-3 w-3" />
              </a>
            ))}
            {study.center_name && <span className="text-muted-foreground">{study.center_name}</span>}
            {study.gold_bucket && (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: getGOLDColorHex(study.gold_bucket) }}
                  aria-hidden
                />
                {study.gold_bucket}
              </span>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <Link
              href="/studies"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" /> Back to Studies
            </Link>
            <CopyLinkButton />
          </div>
        </header>

        <section className="mb-6 border-b border-border pb-4">
          <div className="section-label mb-2.5">Summary</div>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4 lg:grid-cols-5">
            <Leader label="Samples">{num(metrics.sample_count)}</Leader>
            <Leader label="BGCs">{num(metrics.total_bgcs)}</Leader>
            <Leader label="Clustered">{coveragePct == null ? '—' : `${coveragePct}%`}</Leader>
            <Leader label="Distinct GCFs">{num(metrics.distinct_gcfs)}</Leader>
            <Leader label="Exclusive GCFs">
              <span className="text-brand">{num(metrics.exclusive_gcfs)}</span>
            </Leader>
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">
            {num(metrics.clustered_bgcs)} BGCs in a gene-cluster family · {num(unclustered)} unclustered.
          </p>
        </section>

        <div className="space-y-3">
          {hasAbstractContent(study) && (
            <CollapsibleSection title="Abstract" icon={FileText} defaultOpen>
              <div className="px-4 pb-4">
                {showsAbstractText(study) ? (
                  <>
                    {/* hyphens-auto: justified text at ~150 chars per line opens rivers without it. */}
                    <p className="text-justify text-sm leading-relaxed text-muted-foreground hyphens-auto">
                      {abstract}
                    </p>
                    <AbstractCredit
                      source={study.abstract_source}
                      doi={study.abstract_doi}
                      license={study.abstract_license}
                      publisher={study.abstract_publisher}
                      accession={accessions[0] ?? null}
                    />
                  </>
                ) : (
                  <AbstractUnavailable
                    doi={study.abstract_doi ?? study.dois[0] ?? null}
                    publisher={study.abstract_publisher}
                  />
                )}
              </div>
            </CollapsibleSection>
          )}

          {metrics.product_category_dist && (
            <CollapsibleSection
              title="Biosynthetic composition"
              icon={BarChart3}
              defaultOpen
            >
              <div className="px-4 pb-4">
                <StudyProductStrip distribution={metrics.product_category_dist} />
              </div>
            </CollapsibleSection>
          )}

          <CollapsibleSection title="Samples" icon={TestTube} badge={num(metrics.sample_count)}>
            <div className="px-4 pb-4">
              {geography.unit_count > metrics.sample_count && (
                <p className="mb-3 text-xs text-muted-foreground">
                  {num(geography.unit_count)} genome bins from {num(metrics.sample_count)} physical samples —
                  MAG catalogues hold one row per bin.
                </p>
              )}
              <ResizableTable
                columns={sampleColumns}
                data={sampleRows}
                onSort={(colId, dir) => {
                  setSampleSortField(colId);
                  setSampleSortOrder(dir);
                  setSamplePage(0);
                }}
                onColumnResize={(colId, width) =>
                  setSampleColWidths((prev) => ({ ...prev, [colId]: width }))
                }
                onColumnVisibilityChange={(colId, visible) =>
                  setSampleColVisibility((prev) => ({ ...prev, [colId]: visible }))
                }
                sortColumn={sampleSortField}
                sortDirection={sampleSortOrder}
                className="min-w-full"
                emptyState={
                  <div className="py-10 text-center text-muted-foreground">
                    {samplesLoading ? 'Loading samples…' : 'No samples to show.'}
                  </div>
                }
              />

              {sampleTotal > 0 && (
                <div className="mt-4">
                  <Pagination
                    currentPage={samplePage}
                    totalPages={Math.max(1, Math.ceil(sampleTotal / samplePageSize))}
                    totalItems={sampleTotal}
                    offset={samplePage * samplePageSize}
                    pageSize={samplePageSize}
                    onPageChange={setSamplePage}
                    onPageSizeChange={(size) => {
                      setSamplePageSize(size);
                      setSamplePage(0);
                    }}
                  />
                </div>
              )}

              {/* ?studyKey= (exact), not ?study= (title match). Held back until both
                  per-type counts are in, so it never points at the empty side. */}
              {sourceSplitLoaded && (metagenomeTotal > 0 || genomeTotal > 0) && (
                <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  {metagenomeTotal > 0 && genomeTotal > 0 ? (
                    <>
                      <span className="text-muted-foreground">View in tables:</span>
                      <Link
                        href={studySamplesHref(study.study_key, 'metagenome')}
                        className="inline-flex items-center gap-1 text-brand hover:underline"
                      >
                        <span className="font-mono tabular-nums">{metagenomeTotal.toLocaleString()}</span> metagenomes
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </Link>
                      <span aria-hidden className="text-muted-foreground">·</span>
                      <Link
                        href={studySamplesHref(study.study_key, 'genome')}
                        className="inline-flex items-center gap-1 text-brand hover:underline"
                      >
                        <span className="font-mono tabular-nums">{genomeTotal.toLocaleString()}</span> genomes
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </Link>
                    </>
                  ) : (
                    <Link
                      href={studySamplesHref(study.study_key, genomeTotal > 0 ? 'genome' : 'metagenome')}
                      className="inline-flex items-center gap-1.5 text-brand hover:underline"
                    >
                      {genomeTotal > 0 ? 'View in the Genome collections table' : 'View in the Samples table'}
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </Link>
                  )}
                </div>
              )}
            </div>
          </CollapsibleSection>

          {realBiomes.length > 1 && (
            <CollapsibleSection title="Environment" icon={Layers} badge={num(realBiomes.length)}>
              <div className="px-4 pb-4">
                {/* realBiomes, not environment_distribution: the panel is badged on the
                    real biomes, and an "Unclassified" bar would not match the badge. */}
                <ul className="space-y-1.5">
                  {realBiomes.map((e, i) => {
                    const label = e.biome as string;
                    return (
                      <li key={`${label}-${i}`} className="flex items-center gap-3 text-sm">
                        <span className="w-40 shrink-0 truncate" title={label}>
                          {label}
                        </span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-brand/60"
                            style={{ width: `${(e.count / envMax) * 100}%` }}
                          />
                        </div>
                        <span className="w-14 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                          {num(e.count)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </CollapsibleSection>
          )}

          {geography.geo_tagged > 0 && (
            <CollapsibleSection title="Geographic distribution" icon={Globe} badge={num(geography.geo_tagged)}>
              <div className="px-4 pb-4">
                <p className="mb-3 text-xs text-muted-foreground">
                  {num(geography.geo_tagged)} of {num(geography.total)} samples geo-tagged
                  {geography.geo_tagged > mapSamples.length && ` · showing ${num(mapSamples.length)}`}. Points
                  the source flags as unreliable are excluded.
                </p>
                <SampleMapDots samples={mapSamples} height={460} />
              </div>
            </CollapsibleSection>
          )}

          {/* Gated on distinct, not exclusive: a study can have families while none
              are exclusive to it. */}
          {metrics.distinct_gcfs > 0 && (
            <CollapsibleSection
              title="Gene-cluster families"
              icon={Layers}
              badge={num(showExclusive ? exclusiveTotal : allTotal)}
            >
              <div className="px-4 pb-4">
                {/* Reads study_gcf: the summary's top_exclusive_gcfs JSONB is capped at 20. */}
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="inline-flex rounded-md border p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setExclusiveOnly(true);
                        setGcfPage(0);
                      }}
                      className={`rounded px-2.5 py-1 ${
                        showExclusive ? 'bg-brand text-white' : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      Exclusive ({num(exclusiveTotal)})
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setExclusiveOnly(false);
                        setGcfPage(0);
                      }}
                      className={`rounded px-2.5 py-1 ${
                        !showExclusive ? 'bg-brand text-white' : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      All ({num(allTotal)})
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {showExclusive
                      ? 'Families found in no other study.'
                      : 'Every family with a BGC in this study.'}
                    {/* Fragmented singletons hold a BGC of this study but have no family
                        page, so /gcfs (and this table) cannot list them. */}
                    {unlistedGcfs > 0 && (
                      <> {num(unlistedGcfs)} of the {num(metrics.distinct_gcfs)} in
                      Summary are unlisted singletons with no family page.</>
                    )}
                  </p>
                </div>

                <ResizableTable
                  columns={gcfColumns}
                  data={gcfRows}
                  onSort={(colId, dir) => {
                    setGcfSortField(colId);
                    setGcfSortOrder(dir);
                    setGcfPage(0);
                  }}
                  onColumnResize={(colId, width) =>
                    setGcfColWidths((prev) => ({ ...prev, [colId]: width }))
                  }
                  onColumnVisibilityChange={(colId, visible) =>
                    setGcfColVisibility((prev) => ({ ...prev, [colId]: visible }))
                  }
                  sortColumn={gcfSortField}
                  sortDirection={gcfSortOrder}
                  className="min-w-full"
                  emptyState={
                    <div className="py-10 text-center text-muted-foreground">
                      {gcfsLoading ? 'Loading families…' : 'No families to show.'}
                    </div>
                  }
                />

                {gcfTotal > 0 && (
                  <div className="mt-4">
                    <Pagination
                      currentPage={gcfPage}
                      totalPages={Math.max(1, Math.ceil(gcfTotal / gcfPageSize))}
                      totalItems={gcfTotal}
                      offset={gcfPage * gcfPageSize}
                      pageSize={gcfPageSize}
                      onPageChange={setGcfPage}
                      onPageSizeChange={(size) => {
                        setGcfPageSize(size);
                        setGcfPage(0);
                      }}
                    />
                  </div>
                )}
              </div>
            </CollapsibleSection>
          )}
        </div>
      </div>
    </MainLayout>
  );
}
