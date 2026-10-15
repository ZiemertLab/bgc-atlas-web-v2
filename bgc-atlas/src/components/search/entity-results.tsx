'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Download, Loader2 } from 'lucide-react';
import { apiFetch } from '@/lib/basePath';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Pagination } from '@/components/ui/pagination';
import { ResizableTable, type TableColumn } from '@/components/ui/resizable-table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { FragmentedBadge } from '@/components/ui/fragmented-badge';
import { ProductCategoryChart } from '@/components/ui/product-category-chart';
import { BiomeDistributionChart } from '@/components/ui/biome-distribution-chart';
import { TaxonomyDistributionChart } from '@/components/ui/taxonomy-distribution-chart';
import { SampleGcfCount, SAMPLE_GCF_HEADER_TOOLTIP } from '@/components/ui/sample-gcf-count';
import { SampleDataSourceLinks } from '@/components/ui/sample-data-source-links';
import { GCF_NAME_TOOLTIP } from '@/lib/gcf-naming';
import { mapGcfBrowseDocument } from '@/lib/opensearch/gcf-browse-mapper';
import { mapSampleBrowseDocument } from '@/lib/opensearch/sample-browse-mapper';
import { CANDIDATE_CAP, ENTITY_CAP } from '@/lib/opensearch/entity-paging';
import { entityExportColumns, toEntityExportRow } from '@/lib/opensearch/entity-export-columns';
import { serializeDelimited, serializeJsonRows } from '@/lib/opensearch/export-columns';
import { formatBgcLength } from '@/lib/utils/bgc-length';
import { formatBiomeLabel, getEnvironmentColor } from '@/lib/utils/metadata-parser';
import { formatGOLDBreadcrumb, getGOLDBadgeClass } from '@/lib/utils/gold-parser';
import type { FilterGroup } from '@/lib/filters/types';
import { isActiveFamilyScope, type FamilyScope } from '@/lib/filters/family-scope-url';
import type { Sample, TaxonomyRank } from '@/lib/types';

interface EntityRow {
  id: string;
  bgcCount: number;
  source: Record<string, unknown>;
  /** Family-scope only: matching members per cohort, in the cohorts' order. */
  cohortCounts?: number[];
  /** Family-scope only: members inside the cohorts' union. */
  inside?: number;
  /** Family-scope only: members with a value for the cohorts' fields (the purity denominator). */
  located?: number;
  /** Family-scope only: every member, located or not. */
  members?: number;
  /** Family-scope only: inside / located, 0..1. */
  purity?: number;
}
interface EntityResult {
  entity: 'gcfs' | 'samples';
  total: number;
  approximate: boolean;
  capped: boolean;
  /** Family-scope only: pass 1 hit its ceiling, so families were dropped before exclusivity was measured. */
  truncated?: boolean;
  /** Family-scope only: families matching every cohort, before the purity floor. */
  candidates?: number;
  rows: EntityRow[];
}

// The /gcfs browse document plus the count that ordered it; typed off the mapper so they cannot drift.
type GcfRow = ReturnType<typeof mapGcfBrowseDocument> & {
  matchingBgcs: number;
  cohortCounts: number[];
  located: number | null;
  members: number | null;
  purity: number | null;
};
type SampleRow = Sample & { matchingBgcs: number };

function taxonomyDistributionFor(gcf: GcfRow, rank: TaxonomyRank): Record<string, number> | null {
  const byRank: Partial<Record<TaxonomyRank, Record<string, number>>> = {
    ...(gcf.taxonomyDistributionByRank ?? {}),
  };
  if ((!byRank.domain || Object.keys(byRank.domain).length === 0)
    && gcf.taxonomyDistribution
    && Object.keys(gcf.taxonomyDistribution).length > 0) {
    byRank.domain = gcf.taxonomyDistribution;
  }
  const selected = byRank[rank];
  return selected && Object.keys(selected).length > 0 ? selected : null;
}

// Opt-in columns. Family scope adds cohort and coverage columns, so it hides ones that answer other
// questions to stay within the width budget.
const DEFAULT_HIDDEN = (scoped: boolean): string[] => (scoped
  ? [
    'productTypeDistribution', 'petName', 'assemblyCount', 'avgScore', 'length',
    // Either 260px chart would overflow the 1,316px container at 1440px, so both are opt-in.
    'productCategories', 'taxonomyDistribution',
  ]
  : ['productTypeDistribution']);

const IN_COHORTS_TOOLTIP = 'Members matching at least one of the member sets \u2014 the order the results are listed in.';
const MATCHING_TOOLTIP = 'BGCs in this result set that belong to this row — the count the results are ordered by, not the row’s total.';

// Property Search results grouped into GCFs or samples. Rows come from a terms aggregation ordered by
// count, so no column is sortable; the total is a cardinality estimate ("~") and paging stops at ENTITY_CAP.
export function EntityResults({ group, entity, nonce, familyScope }: {
  group: FilterGroup | null;
  entity: 'gcfs' | 'samples';
  nonce: number;
  /** GCFs only: rows are families satisfying every cohort and the purity floor. */
  familyScope?: FamilyScope | null;
}) {
  const [result, setResult] = useState<EntityResult | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);

  // Literal union: biomeDistributionByLevel is keyed 1..5 and a widened type would not index it.
  const [ecosystemLevel, setEcosystemLevel] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [taxonomyRank, setTaxonomyRank] = useState<TaxonomyRank>('phylum');
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});

  const scoped = entity === 'gcfs' && isActiveFamilyScope(familyScope ?? null);
  const cohortLabels = scoped
    ? familyScope!.labels.map((l, i) => l.trim() || `Set ${i + 1}`)
    : [];
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set(DEFAULT_HIDDEN(false)));

  useEffect(() => { setPage(1); }, [nonce, entity]);

  // Scope changes the column set, so reset to that mode's default; widths are kept.
  useEffect(() => { setHiddenColumns(new Set(DEFAULT_HIDDEN(scoped))); }, [scoped]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch('/api/search/properties/entities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        group, entity, page, size: pageSize,
        ...(scoped ? { familyScope: { cohorts: familyScope!.cohorts, minPurity: familyScope!.minPurity } } : {}),
      }),
    })
      .then(async (r) => {
        const d = await r.json();
        if (cancelled) return;
        if (!r.ok) throw new Error(d.error || 'Search failed');
        setResult(d as EntityResult);
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [group, entity, page, pageSize, nonce, scoped, familyScope]);

  const label = entity === 'gcfs' ? 'GCF' : 'sample';
  const visible = (id: string) => !hiddenColumns.has(id);
  const width = (id: string, fallback: number) => columnWidths[id] ?? fallback;

  // Rows are aggregation buckets, so they use the entity column sets: the same flatteners as "All matching".
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const triggerDownload = (content: BlobPart, mime: string, filename: string) => {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
  };
  const mimeFor = (format: 'csv' | 'tsv' | 'json') => (
    format === 'json' ? 'application/json'
      : format === 'csv' ? 'text/csv' : 'text/tab-separated-values');

  const downloadPage = (format: 'csv' | 'tsv' | 'json') => {
    if (!result) return;
    const columns = entityExportColumns(entity, cohortLabels);
    const rows = result.rows.map((row) => toEntityExportRow(entity, row));
    const content = format === 'json'
      ? JSON.stringify(serializeJsonRows(rows, columns), null, 2)
      : serializeDelimited(rows, columns, format === 'csv' ? ',' : '\t');
    triggerDownload(content, mimeFor(format), `bgc_${entity}_page_${page}_${stamp()}.${format}`);
  };

  const downloadAll = async (format: 'csv' | 'tsv' | 'json') => {
    setExporting(true);
    setExportNote(null);
    setError(null);
    try {
      const res = await apiFetch('/api/search/properties/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group, entity, format,
          ...(scoped
            ? {
                familyScope: {
                  cohorts: familyScope!.cohorts,
                  minPurity: familyScope!.minPurity,
                  labels: familyScope!.labels,
                },
              }
            : {}),
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Export failed');
      }
      const count = Number(res.headers.get('X-Result-Count') ?? 0);
      const blob = await res.blob();
      triggerDownload(blob, blob.type, `bgc_${entity}_all_${stamp()}.${format}`);
      if (res.headers.get('X-Capped') === '1') {
        setExportNote(
          `Exported the top ${count.toLocaleString()} ${label}s by matching BGCs — the same `
          + 'ceiling paging stops at. Narrow the query for a complete export.',
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const gcfRows: GcfRow[] = useMemo(
    () => (entity !== 'gcfs' ? [] : (result?.rows ?? []).map((row) => ({
      ...mapGcfBrowseDocument({ gcf_id: row.id, ...row.source }),
      matchingBgcs: row.bgcCount,
      cohortCounts: row.cohortCounts ?? [],
      located: row.located ?? null,
      members: row.members ?? null,
      purity: row.purity ?? null,
    }))),
    [entity, result],
  );

  const sampleRows: SampleRow[] = useMemo(
    () => (entity !== 'samples' ? [] : (result?.rows ?? []).map((row) => ({
      ...mapSampleBrowseDocument(row.id, row.source),
      matchingBgcs: row.bgcCount,
    }))),
    [entity, result],
  );

  const gcfColumns: TableColumn<GcfRow>[] = useMemo(() => [
    {
      id: 'id',
      label: 'GCF ID',
      width: width('id', 140),
      minWidth: 110,
      sortable: false,
      visible: visible('id'),
      renderCell: (gcf: GcfRow) => (
        <Link
          href={`/gcfs/${gcf.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 font-mono text-xs text-foreground underline underline-offset-2 decoration-foreground/50 hover:decoration-foreground"
        >
          {gcf.id.slice(0, 8)}...
          <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
        </Link>
      ),
    },
    {
      id: 'name',
      label: 'Name',
      headerTooltip: GCF_NAME_TOOLTIP,
      width: width('name', scoped ? 220 : 240),
      minWidth: 160,
      sortable: false,
      visible: visible('name'),
      renderCell: (gcf: GcfRow) => (
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">{gcf.name}</span>
          {gcf.familyClass === 'fragmented' && <FragmentedBadge />}
        </div>
      ),
    },
    {
      id: 'petName',
      label: 'Alias',
      width: width('petName', 180),
      minWidth: 120,
      sortable: false,
      visible: visible('petName'),
      renderCell: (gcf: GcfRow) => {
        if (!gcf.petName) return <span className="text-xs text-muted-foreground">—</span>;
        return (
          // `relative` keeps the sr-only prefix inside the cell; without it the prefix escapes the scroll
          // container and adds horizontal page scroll on phones.
          <span
            className="relative block truncate text-muted-foreground"
            title="Human-readable alias — for recall only, not an identifier"
          >
            <span className="sr-only">Alias: </span>
            {gcf.petName}
          </span>
        );
      },
    },
    {
      id: 'matchingBgcs',
      label: scoped ? 'Matching members' : 'Matching BGCs',
      headerTooltip: scoped ? IN_COHORTS_TOOLTIP : MATCHING_TOOLTIP,
      width: width('matchingBgcs', scoped ? 110 : 160),
      minWidth: 110,
      sortable: false,
      visible: visible('matchingBgcs'),
      className: 'text-right',
      renderCell: (row: GcfRow) => (
        <span className="font-medium tabular-nums">{row.matchingBgcs.toLocaleString()}</span>
      ),
    },
    ...(scoped ? cohortLabels.map((label, i) => ({
      id: `cohort${i}`,
      label,
      headerTooltip:
        `Members of this family matching "${label}". Every family listed has at least one.`,
      width: width(`cohort${i}`, 105),
      minWidth: 85,
      sortable: false,
      visible: visible(`cohort${i}`),
      className: 'text-right',
      renderCell: (gcf: GcfRow) => (
        <span className="font-mono tabular-nums">{(gcf.cohortCounts[i] ?? 0).toLocaleString()}</span>
      ),
    })) : []),
    {
      id: 'located',
      label: 'Located',
      headerTooltip:
        'Members with a value for the properties the member sets ask about. A member with no '
        + 'coordinates can neither support nor contradict a claim about latitude, so “only families '
        + 'whose members all match one of these” is measured over these.',
      width: width('located', 120),
      minWidth: 100,
      sortable: false,
      visible: scoped && visible('located'),
      className: 'text-right',
      renderCell: (gcf: GcfRow) => (
        gcf.located === null
          ? <span className="text-xs text-muted-foreground">—</span>
          : (
            // Just this number: the search index and gcf_browse have not always counted
            // members alike, so pairing it with the family's own total could disagree.
            <span
              className="font-mono tabular-nums"
              title={`${Math.round((gcf.purity ?? 0) * 100)}% of them match one of the member sets`}
            >
              {gcf.located.toLocaleString()}
            </span>
          )
      ),
    },
    {
      id: 'memberCount',
      label: 'Member BGCs',
      headerTooltip: 'Every BGC in the family, whether or not it matched this query.',
      width: width('memberCount', scoped ? 140 : 160),
      minWidth: 130,
      sortable: false,
      visible: visible('memberCount'),
      renderCell: (gcf: GcfRow) => (
        <Link
          href={`/bgcs?gcf=${gcf.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-foreground underline underline-offset-2 decoration-foreground/50 hover:decoration-foreground"
        >
          {gcf.memberBgcCount.toLocaleString()}
        </Link>
      ),
    },
    {
      id: 'assemblyCount',
      label: 'Assemblies',
      width: width('assemblyCount', 130),
      minWidth: 100,
      sortable: false,
      visible: visible('assemblyCount'),
      renderCell: (gcf: GcfRow) => (
        <span className="text-muted-foreground">{gcf.assemblyCount.toLocaleString()}</span>
      ),
    },
    {
      id: 'length',
      label: 'Length',
      headerTooltip:
        'Median length of the family’s complete member BGCs. '
        + 'Families with no complete member show the longest member observed, prefixed ≥.',
      width: width('length', 110),
      minWidth: 90,
      sortable: false,
      visible: visible('length'),
      renderCell: (gcf: GcfRow) => {
        const len = formatBgcLength(gcf.lengthStats);
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
      id: 'productCategories',
      label: 'Category distribution',
      width: width('productCategories', 260),
      minWidth: 160,
      sortable: false,
      visible: visible('productCategories'),
      renderCell: (gcf: GcfRow) => {
        if (!gcf.productCategoryDistribution || Object.keys(gcf.productCategoryDistribution).length === 0) {
          return <span className="text-xs text-muted-foreground">None</span>;
        }
        return (
          <div className="w-full px-1">
            <ProductCategoryChart distribution={gcf.productCategoryDistribution} height={24} valueLabel="of members" />
          </div>
        );
      },
    },
    {
      id: 'productTypeDistribution',
      label: 'Product distribution',
      renderHeader: () => (
        <div className="flex items-center gap-1">
          <span>Product distribution</span>
          <InfoTooltip content="Distribution of member BGCs across granular antiSMASH products (e.g. lassopeptide, lanthipeptide)." />
        </div>
      ),
      width: width('productTypeDistribution', 260),
      minWidth: 160,
      sortable: false,
      visible: visible('productTypeDistribution'),
      renderCell: (gcf: GcfRow) => {
        if (!gcf.productTypeDistribution || Object.keys(gcf.productTypeDistribution).length === 0) {
          return <span className="text-xs text-muted-foreground">None</span>;
        }
        return (
          <div className="w-full px-1">
            <ProductCategoryChart distribution={gcf.productTypeDistribution} height={24} />
          </div>
        );
      },
    },
    {
      id: 'biomeDistribution',
      label: 'GOLD Ecosystem',
      headerControl: () => (
        <Select value={String(ecosystemLevel)} onValueChange={(v) => setEcosystemLevel(Number(v) as 1 | 2 | 3 | 4 | 5)}>
          <SelectTrigger className="h-6 w-16 px-2 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {([1, 2, 3, 4, 5] as const).map((level) => (
              <SelectItem key={level} value={String(level)}>L{level}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
      headerTooltip: `Distribution of member BGCs across GOLD ecosystem level ${ecosystemLevel} classifications`,
      width: width('biomeDistribution', 260),
      minWidth: 160,
      sortable: false,
      visible: visible('biomeDistribution'),
      renderCell: (gcf: GcfRow) => {
        const distribution = gcf.biomeDistributionByLevel?.[ecosystemLevel] ?? {};
        if (Object.keys(distribution).length === 0) {
          return <span className="text-xs text-muted-foreground">No data</span>;
        }
        return (
          <div className="w-full px-1">
            <BiomeDistributionChart distribution={distribution} height={24} />
          </div>
        );
      },
    },
    {
      id: 'taxonomyDistribution',
      label: 'Taxonomy',
      headerControl: () => (
        <Select value={taxonomyRank} onValueChange={(v) => setTaxonomyRank(v as TaxonomyRank)}>
          <SelectTrigger className="h-6 w-auto min-w-20 px-2 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="domain">Domain</SelectItem>
            <SelectItem value="phylum">Phylum</SelectItem>
            <SelectItem value="class">Class</SelectItem>
            <SelectItem value="order">Order</SelectItem>
            <SelectItem value="family">Family</SelectItem>
            <SelectItem value="genus">Genus</SelectItem>
            <SelectItem value="species">Species</SelectItem>
          </SelectContent>
        </Select>
      ),
      headerTooltip: 'Distribution of member BGCs across the selected GTDB taxonomy rank.',
      width: width('taxonomyDistribution', 260),
      minWidth: 160,
      sortable: false,
      visible: visible('taxonomyDistribution'),
      renderCell: (gcf: GcfRow) => {
        const distribution = taxonomyDistributionFor(gcf, taxonomyRank);
        if (!distribution) return <span className="text-xs text-muted-foreground">No data</span>;
        return (
          <div className="w-full px-1">
            <TaxonomyDistributionChart distribution={distribution} height={24} />
          </div>
        );
      },
    },
    {
      id: 'avgScore',
      label: 'Avg Distance',
      headerTooltip: 'Average BiG-SLiCE distance of member BGCs to this family (lower = more similar).',
      width: width('avgScore', 170),
      minWidth: 120,
      sortable: false,
      visible: visible('avgScore'),
      renderCell: (gcf: GcfRow) => (
        <span className="font-mono text-xs">
          {gcf.avgDistance !== null ? gcf.avgDistance.toFixed(3) : 'N/A'}
        </span>
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [ecosystemLevel, taxonomyRank, columnWidths, hiddenColumns, scoped, cohortLabels.join('|')]);

  const sampleColumns: TableColumn<SampleRow>[] = useMemo(() => [
    {
      id: 'id',
      label: 'Sample ID',
      width: width('id', 190),
      minWidth: 130,
      sortable: false,
      visible: visible('id'),
      renderCell: (sample: SampleRow) => {
        const label = sample.externalId || sample.name || sample.id;
        return (
          <Link
            href={`/samples/${sample.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 truncate font-mono text-xs text-foreground underline underline-offset-2 decoration-foreground/50 hover:decoration-foreground"
            title={String(label)}
          >
            {label}
            <ArrowUpRight className="h-3 w-3 shrink-0" aria-hidden="true" />
          </Link>
        );
      },
    },
    {
      id: 'matchingBgcs',
      label: 'Matching BGCs',
      headerTooltip: MATCHING_TOOLTIP,
      width: width('matchingBgcs', 160),
      minWidth: 130,
      sortable: false,
      visible: visible('matchingBgcs'),
      className: 'text-right',
      renderCell: (row: SampleRow) => (
        <span className="font-medium tabular-nums">{row.matchingBgcs.toLocaleString()}</span>
      ),
    },
    {
      id: 'bgcs',
      label: '# BGCs',
      headerTooltip: 'Every BGC in the sample, whether or not it matched this query.',
      width: width('bgcs', 130),
      minWidth: 100,
      sortable: false,
      visible: visible('bgcs'),
      className: 'text-center',
      renderCell: (sample: SampleRow) => (
        (sample.bgcCount ?? 0) > 0 ? (
          <Link
            href={`/bgcs?sampleId=${sample.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium tabular-nums text-foreground underline underline-offset-2 decoration-foreground/50 hover:decoration-foreground"
          >
            {sample.bgcCount?.toLocaleString()}
          </Link>
        ) : (
          <span className="font-medium tabular-nums text-muted-foreground">0</span>
        )
      ),
    },
    {
      id: 'gcfs',
      label: '# GCFs',
      headerTooltip: SAMPLE_GCF_HEADER_TOOLTIP,
      width: width('gcfs', 120),
      minWidth: 100,
      sortable: false,
      visible: visible('gcfs'),
      className: 'text-center',
      renderCell: (sample: SampleRow) => <SampleGcfCount sample={sample} />,
    },
    {
      id: 'assemblies',
      label: 'Assemblies',
      width: width('assemblies', 120),
      minWidth: 100,
      sortable: false,
      visible: visible('assemblies'),
      className: 'text-center',
      renderCell: (sample: SampleRow) => (
        <span className="tabular-nums text-muted-foreground">
          {(sample.assemblyCount ?? 0).toLocaleString()}
        </span>
      ),
    },
    {
      id: 'location',
      label: 'Location',
      width: width('location', 200),
      minWidth: 140,
      sortable: false,
      visible: visible('location'),
      renderCell: (sample: SampleRow) => (
        <span className="truncate text-sm" title={sample.location}>{sample.location || '-'}</span>
      ),
    },
    {
      id: 'biome',
      label: 'Biome',
      width: width('biome', 190),
      minWidth: 140,
      sortable: false,
      visible: visible('biome'),
      renderCell: (sample: SampleRow) => {
        const rawBiome = (sample.primaryBiome?.trim() || sample.environmentBiome?.trim()) ?? '';
        if (!rawBiome || /^root$/i.test(rawBiome)) {
          return <span className="text-sm text-muted-foreground">-</span>;
        }
        return (
          <div className="max-w-full">
            <Badge
              variant="secondary"
              className={`text-xs ${getEnvironmentColor(rawBiome)} h-auto max-w-full whitespace-normal`}
              title={rawBiome}
            >
              {formatBiomeLabel(rawBiome)}
            </Badge>
          </div>
        );
      },
    },
    {
      id: 'goldEcosystem',
      label: 'GOLD Ecosystem',
      width: width('goldEcosystem', 240),
      minWidth: 180,
      sortable: false,
      visible: visible('goldEcosystem'),
      renderCell: (sample: SampleRow) => {
        const path = sample.goldEcosystemPath;
        if (!path) return <span className="text-sm text-muted-foreground">-</span>;
        return (
          <div className="max-w-full">
            <Badge
              variant="secondary"
              className={`text-xs ${getGOLDBadgeClass(path)} h-auto max-w-full whitespace-normal`}
              title={path}
            >
              {formatGOLDBreadcrumb(path)}
            </Badge>
          </div>
        );
      },
    },
    {
      id: 'environment',
      label: 'Environment',
      width: width('environment', 200),
      minWidth: 140,
      sortable: false,
      visible: visible('environment'),
      renderCell: (sample: SampleRow) => {
        const environment = sample.environment?.trim();
        if (!environment) return <span className="text-sm text-muted-foreground">-</span>;
        return <span className="block truncate text-sm" title={environment}>{environment}</span>;
      },
    },
    {
      id: 'material',
      label: 'Material',
      width: width('material', 160),
      minWidth: 120,
      sortable: false,
      visible: visible('material'),
      renderCell: (sample: SampleRow) => (
        <span className="block truncate text-sm" title={sample.environmentMaterial}>
          {sample.environmentMaterial || '-'}
        </span>
      ),
    },
    {
      id: 'feature',
      label: 'Feature',
      width: width('feature', 160),
      minWidth: 120,
      sortable: false,
      visible: visible('feature'),
      renderCell: (sample: SampleRow) => (
        <span className="block truncate text-sm" title={sample.environmentFeature}>
          {sample.environmentFeature || '-'}
        </span>
      ),
    },
    {
      id: 'host',
      label: 'Host',
      width: width('host', 160),
      minWidth: 120,
      sortable: false,
      visible: visible('host'),
      renderCell: (sample: SampleRow) => {
        const display = sample.hostSpecies || (sample.hostTaxid != null ? String(sample.hostTaxid) : '');
        return (
          <span className="block truncate text-sm" title={display || undefined}>{display || '-'}</span>
        );
      },
    },
    {
      id: 'study',
      label: 'Study',
      width: width('study', 220),
      minWidth: 160,
      sortable: false,
      visible: visible('study'),
      renderCell: (sample: SampleRow) => {
        const studyTitles = Array.isArray(sample.studyTitles) ? sample.studyTitles : [];
        const primaryStudy = studyTitles[0];
        const tooltip = studyTitles.length > 1 ? studyTitles.join(', ') : primaryStudy;
        return (
          <span className="block truncate text-sm" title={tooltip || undefined}>
            {primaryStudy || '-'}
          </span>
        );
      },
    },
    {
      id: 'dataSource',
      label: 'Data Source',
      width: width('dataSource', 190),
      minWidth: 140,
      sortable: false,
      visible: visible('dataSource'),
      renderCell: (sample: SampleRow) => (
        <SampleDataSourceLinks names={sample.dataSourceNames} externalId={sample.externalId} />
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [columnWidths, hiddenColumns]);

  if (error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
        {error}
      </div>
    );
  }
  if (!result && loading) {
    return (
      <Card className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Grouping matching BGCs…
      </Card>
    );
  }
  if (!result) return null;

  const totalPages = Math.max(1, Math.ceil(Math.min(result.total, ENTITY_CAP) / pageSize));

  const onColumnResize = (columnId: string, w: number) =>
    setColumnWidths((prev) => ({ ...prev, [columnId]: w }));
  const onColumnVisibilityChange = (columnId: string, isVisible: boolean) =>
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (isVisible) next.delete(columnId);
      else next.add(columnId);
      return next;
    });

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <span className="text-sm font-medium">
          {entity === 'gcfs' ? 'GCFs' : 'Samples'}
        </span>
        <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">
          {/* Scoped results are exact; the plain path uses a cardinality agg, estimated above its precision threshold. */}
          {result.approximate ? '~' : ''}{result.total.toLocaleString()}
        </span>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        <div className="ml-auto flex items-center gap-3">
          <span className="text-[11px] text-muted-foreground">
            ordered by {scoped ? 'matching members' : 'matching BGCs'}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={exporting || !result.total}>
                {exporting
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : <Download className="mr-2 h-4 w-4" />}
                Download
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="text-xs">
                This page ({result.rows.length} row{result.rows.length === 1 ? '' : 's'})
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={() => downloadPage('csv')}>CSV</DropdownMenuItem>
              <DropdownMenuItem onClick={() => downloadPage('tsv')}>TSV</DropdownMenuItem>
              <DropdownMenuItem onClick={() => downloadPage('json')}>JSON</DropdownMenuItem>
              <DropdownMenuSeparator />
              {/* The export runs the same aggregation, so its ceiling is the pager's. */}
              <DropdownMenuLabel className="text-xs">
                All matching (max {ENTITY_CAP.toLocaleString()})
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={() => downloadAll('csv')}>CSV</DropdownMenuItem>
              <DropdownMenuItem onClick={() => downloadAll('tsv')}>TSV</DropdownMenuItem>
              <DropdownMenuItem onClick={() => downloadAll('json')}>JSON</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {exportNote && (
        <p className="px-4 pb-3 text-[11px] text-muted-foreground">{exportNote}</p>
      )}

      {/* The second number is the count without the purity floor. */}
      {scoped && result.candidates !== undefined && familyScope!.minPurity > 0
        && result.candidates !== result.total && (
        <p className="px-4 pb-3 text-[11px] text-muted-foreground">
          {result.candidates.toLocaleString()} without &ldquo;Only families whose members all match one of these&rdquo;
        </p>
      )}

      {result.truncated && (
        <p className="mx-4 mb-3 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-[11px] text-warning">
          These conditions match too much of the atlas to list every family: families beyond the
          first {CANDIDATE_CAP.toLocaleString()} were dropped, smallest first. These results are a
          subset, not the answer — narrow the conditions.
        </p>
      )}

      {result.capped ? (
        <p className="px-4 pb-4 text-sm text-muted-foreground">
          Paging stops at the first {ENTITY_CAP.toLocaleString()} {label}s. Narrow the
          query to reach the rest.
        </p>
      ) : (
        <>
          <div className="border-t p-3">
            {/* Remount on entity change: ResizableTable seeds its column state once. */}
            {entity === 'gcfs' ? (
              <ResizableTable<GcfRow>
                key="gcfs"
                columns={gcfColumns}
                data={gcfRows}
                emptyState="No GCFs"
                onColumnResize={onColumnResize}
                onColumnVisibilityChange={onColumnVisibilityChange}
              />
            ) : (
              <ResizableTable<SampleRow>
                key="samples"
                columns={sampleColumns}
                data={sampleRows}
                emptyState="No samples"
                onColumnResize={onColumnResize}
                onColumnVisibilityChange={onColumnVisibilityChange}
              />
            )}
          </div>

          {result.total > 0 && (
            <Pagination
              currentPage={page - 1}
              totalPages={totalPages}
              totalItems={Math.min(result.total, ENTITY_CAP)}
              pageSize={pageSize}
              offset={(page - 1) * pageSize}
              onPageChange={(p0) => setPage(p0 + 1)}
              onPageSizeChange={(ps) => { setPageSize(ps); setPage(1); }}
            />
          )}
          {result.total > ENTITY_CAP && (
            <p className="px-4 pb-3 text-[11px] text-muted-foreground">
              Showing the top {ENTITY_CAP.toLocaleString()} {label}s by matching BGCs, out of
              {' '}{result.approximate ? '~' : ''}{result.total.toLocaleString()}. The ceiling is
              the cluster&rsquo;s bucket limit — narrow the query to reach the rest.
            </p>
          )}
        </>
      )}
    </Card>
  );
}
