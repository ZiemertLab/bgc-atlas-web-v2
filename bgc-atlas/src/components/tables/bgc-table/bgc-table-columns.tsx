'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getProductCategoryBadgeStyle, getTaxonomyBadgeStyle } from '@/lib/utils/chart-utils';
import { formatGOLDBreadcrumb, getGOLDBadgeClass } from '@/lib/utils/gold-parser';
import { getTaxonDisplayName, formatTaxonomyBreadcrumb } from '@/lib/utils/taxonomy-utils';
import { sampleBrowseHref, sampleBrowseLabel } from '@/lib/utils/sample-link';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { BgcListItem, BgcTableContextValue } from './bgc-table-types';
import { BgcSourceCell } from './bgc-source-cell';
import { useDataSourceOptions } from '@/lib/hooks/use-data-source-options';
import { hasAnyActiveFilter } from '@/lib/bgc-sort';
import { withBase } from '@/lib/basePath';
import { GCF_NAME_TOOLTIP } from '@/lib/gcf-naming';
import { KnownClusterCell } from '@/components/ui/known-cluster-cell';

export function useBgcTableColumns(context: BgcTableContextValue) {
  const {
    columnWidths,
    columnVisibility,
    openingBgcId,
    taxonomyRank,
    setTaxonomyRank,
    handleBgcClick,
    preFilters,
    filters,
  } = context;

  const dataSourceOptions = useDataSourceOptions();

  // Taxonomy sorting scans the whole corpus unless something narrows it first.
  const taxonomySortable = hasAnyActiveFilter(preFilters, filters);

  const columns = useMemo(() => [
    {
      id: 'id',
      label: 'BGC ID',
      width: columnWidths.id,
      minWidth: 100,
      sortable: true,
      filterable: true,
      filterType: 'text' as const,
      visible: columnVisibility.id,
      renderCell: (bgc: BgcListItem) => {
        return (
          <div className="flex items-center gap-2">
            <Link
              href={`/bgcs/${bgc.id}`}
              className="inline-flex items-center gap-0.5 font-mono text-xs text-foreground underline underline-offset-2 decoration-foreground/50 hover:decoration-foreground"
              title={bgc.id}
            >
              {bgc.id.slice(0, 8)}...
              <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          </div>
        );
      }
    },
    {
      id: 'assembly',
      label: 'Assembly',
      width: columnWidths.assembly,
      minWidth: 100,
      sortable: true,
      filterable: true,
      filterType: 'text' as const,
      visible: columnVisibility.assembly,
      renderCell: (bgc: BgcListItem) => {
        if (!bgc?.antismashRunId) {
          return (
            <span className="font-mono text-sm" title={bgc.assemblyDisplay || ''}>
              {bgc.assemblyDisplay || '—'}
            </span>
          );
        }

        const isLoading = openingBgcId === bgc.id;

        return (
          <button
            type="button"
            onClick={() => handleBgcClick(bgc)}
            className="inline-flex items-center gap-2 font-mono text-sm text-foreground underline underline-offset-2 decoration-foreground/50 hover:decoration-foreground disabled:pointer-events-none cursor-pointer"
            title={bgc.assemblyDisplay || ''}
            disabled={isLoading}
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            <span>{bgc.assemblyDisplay || bgc.assembly}</span>
          </button>
        );
      }
    },
    {
      id: 'source',
      label: 'Source',
      width: columnWidths.source ?? 160,
      minWidth: 100,
      sortable: false,
      filterable: true,
      filterType: 'select' as const,
      filterOptions: dataSourceOptions,
      visible: columnVisibility.source ?? true,
      renderCell: (bgc: BgcListItem) => (
        <BgcSourceCell
          dataSourceNames={bgc.dataSourceNames}
          sampleExternalId={Array.isArray(bgc.sampleLabels) ? bgc.sampleLabels[0] ?? null : null}
        />
      )
    },
    {
      id: 'samples',
      label: 'Sample',
      width: columnWidths.samples,
      minWidth: 140,
      sortable: false,
      filterable: true,
      filterType: 'text' as const,
      visible: columnVisibility.samples,
      renderCell: (bgc: BgcListItem) => {
        const ids: string[] = Array.isArray(bgc.sampleIds) ? bgc.sampleIds : [];
        const labels: string[] = Array.isArray(bgc.sampleLabels) ? bgc.sampleLabels : [];
        if (ids.length === 0) return <span className="text-muted-foreground">—</span>;

        const items = ids.slice(0, 3).map((id, i) => ({
          id,
          label: labels[i] || id,
        }));

        // A MAG/SAG/isolate sample lives on Genome Collections, not the Metagenomes page.
        const pageLabel = sampleBrowseLabel(bgc.assemblySourceType);

        return (
          <div className="flex flex-wrap gap-1">
            {items.map(({ id, label }) => (
              <a
                key={id}
                href={withBase(sampleBrowseHref(id, bgc.assemblySourceType))}
                className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-xs text-foreground underline underline-offset-2 decoration-foreground/50 hover:decoration-foreground"
                target="_blank" rel="noopener noreferrer"
                title={`Open ${pageLabel} filtered to ${label}`}
              >
                {label}
              </a>
            ))}
            {ids.length > 3 ? (
              <span className="text-xs text-muted-foreground">+{ids.length - 3} more</span>
            ) : null}
          </div>
        );
      }
    },
    {
      id: 'class',
      label: 'Category',
      width: columnWidths.class,
      minWidth: 100,
      sortable: true,
      filterable: true,
      filterType: 'select' as const,
      filterOptions: [
        { label: 'NRPS', value: 'NRPS' },
        { label: 'PKS', value: 'PKS' },
        { label: 'RiPP', value: 'RiPP' },
        { label: 'terpene', value: 'terpene' },
        { label: 'saccharide', value: 'saccharide' },
        { label: 'other', value: 'other' },
        { label: 'Hybrid', value: 'Hybrid' }
      ],
      visible: columnVisibility.class,
      renderCell: (bgc: BgcListItem) => {
        if (!bgc.category) return <span className="text-muted-foreground">—</span>;

        if (bgc.category === 'Hybrid' && Array.isArray(bgc.categories) && bgc.categories.length > 0) {
          return (
            <div className="flex flex-wrap gap-1">
              {bgc.categories.map((t: string, i: number) => (
                <Badge key={`${bgc.id}-t-${i}`} variant="secondary" style={getProductCategoryBadgeStyle(t)}>
                  {t}
                </Badge>
              ))}
            </div>
          );
        }

        return (
          <Badge variant="secondary" style={getProductCategoryBadgeStyle(bgc.category)}>
            {bgc.category}
          </Badge>
        );
      }
    },
    {
      id: 'type',
      label: 'Product',
      width: columnWidths.type,
      minWidth: 120,
      sortable: true,
      filterable: true,
      filterType: 'text' as const,
      visible: columnVisibility.type,
      renderCell: (bgc: BgcListItem) => {
        if (!Array.isArray(bgc.products) || bgc.products.length === 0) {
          return <span className="text-muted-foreground">—</span>;
        }

        return (
          <div className="flex flex-wrap gap-1">
            {bgc.products.map((pt: string, i: number) => (
              <Badge key={`${bgc.id}-pt-${i}`} variant="outline">{pt}</Badge>
            ))}
          </div>
        );
      }
    },
    {
      id: 'completeness',
      label: 'Completeness',
      headerTooltip: 'antiSMASH completeness prediction',
      width: columnWidths.completeness,
      minWidth: 120,
      sortable: true,
      filterable: true,
      filterType: 'select' as const,
      filterOptions: [
        { label: 'complete', value: 'complete' },
        { label: 'partial', value: 'partial' },
        { label: 'unknown', value: 'unknown' }
      ],
      visible: columnVisibility.completeness,
      renderCell: (bgc: BgcListItem) => (
        <span className="text-sm">{bgc.completeness || '—'}</span>
      )
    },
    {
      id: 'goldEcosystem',
      label: 'GOLD Ecosystem',
      width: columnWidths.goldEcosystem || 240,
      minWidth: 200,
      sortable: false,
      filterable: true,
      filterType: 'text' as const,
      visible: columnVisibility.goldEcosystem ?? true,
      renderCell: (bgc: BgcListItem) => {
        const path = bgc.goldEcosystemPath;
        if (!path) {
          return <span className="text-sm text-muted-foreground">-</span>;
        }

        const breadcrumb = formatGOLDBreadcrumb(path);
        const colorClass = getGOLDBadgeClass(path);

        return (
          <div className="max-w-full">
            <Badge
              variant="secondary"
              className={`text-xs ${colorClass} h-auto max-w-full whitespace-normal`}
              title={path}
            >
              {breadcrumb}
            </Badge>
          </div>
        );
      }
    },
    {
      id: 'taxonomy',
      label: 'Taxonomy',
      headerControl: () => (
        <Select
          value={taxonomyRank}
          onValueChange={(value) => setTaxonomyRank(value as 'auto' | 'domain' | 'phylum' | 'class' | 'order' | 'family' | 'genus' | 'species')}
        >
          <SelectTrigger className="h-6 w-auto min-w-20 text-xs px-2">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto</SelectItem>
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
      headerTooltip: taxonomySortable
        ? "Taxonomic classification from GTDB. 'Auto' shows the most specific rank available."
        : "Taxonomic classification from GTDB. 'Auto' shows the most specific rank available.",
      width: columnWidths.taxonomy || 280,
      minWidth: 240,
      // Scan-heavy: no index supplies this order (see lib/bgc-sort.ts).
      sortable: taxonomySortable,
      filterable: true,
      filterType: 'text' as const,
      visible: columnVisibility.taxonomy ?? true,
      renderCell: (bgc: BgcListItem) => {
        let taxon: string | null = null;

        if (taxonomyRank === 'auto') {
          taxon = bgc.taxonomySpecies || bgc.taxonomyGenus || bgc.taxonomyFamily ||
                  bgc.taxonomyOrder || bgc.taxonomyClass || bgc.taxonomyPhylum ||
                  bgc.taxonomyDomain;
        } else {
          const rankMap = {
            domain: bgc.taxonomyDomain,
            phylum: bgc.taxonomyPhylum,
            class: bgc.taxonomyClass,
            order: bgc.taxonomyOrder,
            family: bgc.taxonomyFamily,
            genus: bgc.taxonomyGenus,
            species: bgc.taxonomySpecies,
          };
          taxon = rankMap[taxonomyRank];
        }

        if (!taxon) {
          return <span className="text-sm text-muted-foreground">-</span>;
        }

        const displayName = getTaxonDisplayName(taxon);

        const lineageParts = bgc.gtdbLineage
          ? formatTaxonomyBreadcrumb(bgc.gtdbLineage)
          : [bgc.taxonomyDomain, bgc.taxonomyPhylum, bgc.taxonomyClass, bgc.taxonomyOrder,
             bgc.taxonomyFamily, bgc.taxonomyGenus, bgc.taxonomySpecies]
              .filter((t): t is string => Boolean(t))
              .map((t) => getTaxonDisplayName(t));
        const fullPath = lineageParts.join(' › ') || displayName;

        const badgeStyle = getTaxonomyBadgeStyle(taxonomyRank, bgc.taxonomyPhylum, bgc.taxonomyDomain);

        return (
          <div className="max-w-full">
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant={badgeStyle ? 'secondary' : 'outline'}
                  className="text-xs max-w-full whitespace-normal h-auto"
                  style={badgeStyle}
                >
                  {displayName}
                </Badge>
              </TooltipTrigger>
              <TooltipContent className="max-w-[440px]">
                <p className="text-xs leading-relaxed">{fullPath}</p>
              </TooltipContent>
            </Tooltip>
          </div>
        );
      }
    },
    {
      id: 'length',
      label: 'Length (bp)',
      width: columnWidths.length,
      minWidth: 100,
      sortable: true,
      defaultSortDirection: 'desc' as const,
      filterable: true,
      filterType: 'range' as const,
      visible: columnVisibility.length,
      className: 'text-right',
      renderCell: (bgc: BgcListItem) => (
        <span className="font-mono text-sm">{(bgc.length || 0).toLocaleString()}</span>
      )
    },
    {
      id: 'genes',
      label: 'Genes',
      width: columnWidths.genes,
      minWidth: 80,
      sortable: true,
      defaultSortDirection: 'desc' as const,
      filterable: true,
      filterType: 'range' as const,
      visible: columnVisibility.genes,
      className: 'text-center',
      renderCell: (bgc: BgcListItem) => (
        <span>{bgc.genes || 0}</span>
      )
    },
    {
      id: 'gcf',
      label: 'GCF',
      headerTooltip: GCF_NAME_TOOLTIP,
      width: columnWidths.gcf,
      minWidth: 80,
      sortable: true,
      filterable: true,
      filterType: 'text' as const,
      visible: columnVisibility.gcf,
      renderCell: (bgc: BgcListItem) => (
        bgc.gcfName || bgc.gcf ? (
          <span className="text-sm">{bgc.gcfName || bgc.gcf}</span>
        ) : (
          // Unreachable here (one family's members); kept in step with /bgcs.
          <span className="text-sm text-muted-foreground">Unclustered</span>
        )
      )
    },
    {
      id: 'knownCluster',
      label: 'KnownClusterBLAST',
      headerTooltip:
        'Closest characterized MIBiG cluster by antiSMASH KnownClusterBLAST, with its '
        + 'similarity. Only hits at 50% or above are shown — below that the field is '
        + 'mostly a couple of genes matching by chance. This is homology for THIS '
        + 'region, not the family-level MIBiG relative on /gcfs.',
      width: columnWidths.knownCluster,
      minWidth: 120,
      // Fetched per page from bgc_facets; bgc_browse, which answers the query, lacks the field.
      sortable: false,
      visible: columnVisibility.knownCluster,
      renderCell: (bgc: BgcListItem) =>
        bgc.knownCluster ? (
          <KnownClusterCell
            compound={bgc.knownCluster.compound}
            accession={bgc.knownCluster.accession}
            similarity={bgc.knownCluster.similarity}
          />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      id: 'distance',
      label: 'GCF Distance',
      headerTooltip: 'BiG-SLiCE distance of this BGC to its gene cluster family (lower = more similar / closer).',
      width: columnWidths.distance,
      minWidth: 100,
      sortable: true,
      filterable: true,
      filterType: 'range' as const,
      visible: columnVisibility.distance,
      className: 'text-right',
      renderCell: (bgc: BgcListItem) => (
        <span
          className={
            typeof bgc.distance === 'number'
              ? 'font-mono tabular-nums text-foreground'
              : 'text-muted-foreground'
          }
        >
          {typeof bgc.distance === 'number' ? bgc.distance.toFixed(3) : '—'}
        </span>
      )
    }
  ], [
    taxonomyRank,
    columnWidths,
    columnVisibility,
    openingBgcId,
    handleBgcClick,
    setTaxonomyRank,
    dataSourceOptions,
    taxonomySortable,
  ]);

  return columns;
}
