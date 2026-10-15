"use client";

import Link from 'next/link';
import { withBase } from "@/lib/basePath";
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowUpRight } from 'lucide-react';
import { formatBiomeLabel } from '@/lib/utils/metadata-parser';
import { getProductCategoryBadgeStyle } from '@/lib/utils/chart-utils';
import { sampleBrowseHref, sampleBrowseLabel } from '@/lib/utils/sample-link';
import { BgcSourceCell } from '@/components/tables/bgc-table/bgc-source-cell';

// Every flex/grid child carries `min-w-0`: CardHeader is a CSS grid, so without it
// long names or badge rows push past the card border.
interface BgcCardProps {
  bgc: {
    id: string;
    name: string;
    category: string | null;
    categories: string[];
    products: string[];
    completeness: 'complete' | 'partial' | 'unknown';
    length: number | null;
    genes: number | null;
    gcf: string | null;
    gcfName?: string | null;
    // BiG-SLiCE distance to the GCF; lower = more similar.
    distance: number | null;
    biomeLevels: string[];
    biomeEnvironment: string[];
    sampleIds: string[];
    sampleLabels: string[];
    dataSourceNames?: string[] | null;
    // MAG/SAG/isolate samples live on Genome Collections, not the Metagenomes page.
    assemblySourceType?: string | null;
  };
}

const LABEL_CLASSES = 'text-[10px] font-medium uppercase tracking-wide text-muted-foreground';

export function BgcCard({ bgc }: BgcCardProps) {
  const levels: string[] = Array.isArray(bgc.biomeLevels)
    ? bgc.biomeLevels.filter((value: string) => Boolean(value && value.trim()))
    : [];
  const environmentFallback: string[] = Array.isArray(bgc.biomeEnvironment)
    ? bgc.biomeEnvironment.filter((value: string) => Boolean(value && value.trim()))
    : [];

  const rawBiome = levels[0] || environmentFallback[0] || '';
  const displayLabel = formatBiomeLabel(rawBiome);
  const hasBiome = Boolean(rawBiome) && displayLabel !== 'Unknown';

  const displayName = bgc.name?.trim() || bgc.id;
  const shortId = bgc.id.slice(0, 8);

  // The `.regionNNN` suffix identifies the region, so it is kept as a non-shrinking span.
  const regionSuffix = displayName.match(/^(.*)(\.region\d+)$/i);
  const nameHead = regionSuffix ? regionSuffix[1] : displayName;
  const nameTail = regionSuffix ? regionSuffix[2] : '';

  const classes = bgc.category === 'Hybrid' && bgc.categories.length > 0
    ? bgc.categories
    : bgc.category
      ? [bgc.category]
      : [];
  const shownClasses = classes.slice(0, 2);
  const hiddenClasses = classes.length - shownClasses.length;

  const shownProductTypes = bgc.products.slice(0, 3);
  const hiddenProductTypes = bgc.products.length - shownProductTypes.length;

  const shownSamples = bgc.sampleIds.slice(0, 2);
  const hiddenSamples = bgc.sampleIds.length - shownSamples.length;

  return (
    <Card className="gap-3 overflow-hidden transition-colors hover:border-foreground/30">
      <CardHeader className="gap-1.5">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <CardTitle className="min-w-0 flex-1">
            <Link
              href={`/bgcs/${bgc.id}`}
              className="flex min-w-0 font-mono text-sm font-semibold underline-offset-2 hover:underline"
              title={displayName}
            >
              <span className="truncate">{nameHead}</span>
              {nameTail && <span className="shrink-0">{nameTail}</span>}
            </Link>
          </CardTitle>
          {shownClasses.length > 0 && (
            <div className="flex shrink-0 flex-wrap justify-end gap-1">
              {shownClasses.map((t: string, i: number) => (
                <Badge key={`${bgc.id}-t-${i}`} variant="secondary" style={getProductCategoryBadgeStyle(t)}>
                  {t}
                </Badge>
              ))}
              {hiddenClasses > 0 && <Badge variant="outline">+{hiddenClasses}</Badge>}
            </div>
          )}
        </div>
        {/* Wraps rather than truncates, so long source labels do not eat the id line. */}
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <span
            className="shrink-0 whitespace-nowrap font-mono text-[11px] text-muted-foreground"
            title={bgc.id}
          >
            {shortId}
            {bgc.completeness && bgc.completeness !== 'unknown' ? ` · ${bgc.completeness}` : ''}
          </span>
          <div className="flex min-w-0 flex-wrap justify-end">
            <BgcSourceCell
              dataSourceNames={bgc.dataSourceNames}
              sampleExternalId={bgc.sampleLabels[0] ?? null}
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <dl className="grid grid-cols-3 gap-2 border-y border-border py-2.5">
          <div className="min-w-0">
            {/* Unit in the label: "667,041 bp" overflows a third of a 320px card. */}
            <dt className={LABEL_CLASSES}>Length (bp)</dt>
            <dd className="truncate font-mono text-sm tabular-nums">
              {bgc.length ? bgc.length.toLocaleString() : '—'}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className={LABEL_CLASSES}>Genes</dt>
            <dd className="truncate font-mono text-sm tabular-nums">
              {bgc.genes !== null ? bgc.genes.toLocaleString() : '—'}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className={LABEL_CLASSES}>GCF Distance</dt>
            <dd className="truncate font-mono text-sm tabular-nums">
              {bgc.distance !== null ? bgc.distance.toFixed(3) : '—'}
            </dd>
          </div>
        </dl>

        <div className="flex min-w-0 items-center justify-between gap-2">
          <span className={LABEL_CLASSES}>GCF</span>
          {bgc.gcf ? (
            <Link
              href={`/gcfs/${encodeURIComponent(bgc.gcf)}`}
              className="inline-flex min-w-0 items-center gap-0.5 font-mono text-sm underline underline-offset-2 decoration-foreground/50 hover:decoration-foreground"
              title={`View GCF ${bgc.gcfName || bgc.gcf}`}
            >
              <span className="truncate">{bgc.gcfName || bgc.gcf}</span>
              <ArrowUpRight className="size-3 shrink-0" aria-hidden />
            </Link>
          ) : (
            <span className="text-sm text-muted-foreground">Unclustered</span>
          )}
        </div>

        {(hasBiome || shownProductTypes.length > 0) && (
          <div className="flex min-w-0 flex-wrap gap-1">
            {hasBiome && (
              <span className="inline-flex max-w-full items-center rounded bg-muted px-1.5 py-0.5 text-[11px] text-foreground">
                <span className="truncate">{displayLabel}</span>
              </span>
            )}
            {shownProductTypes.map((pt, i) => (
              <Badge key={`${bgc.id}-pt-${i}`} variant="outline" className="max-w-full text-[11px]">
                <span className="truncate">{pt}</span>
              </Badge>
            ))}
            {hiddenProductTypes > 0 && (
              <Badge variant="outline" className="text-[11px]">+{hiddenProductTypes}</Badge>
            )}
          </div>
        )}

        {shownSamples.length > 0 && (
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className={LABEL_CLASSES}>Samples</span>
            {shownSamples.map((id, i) => (
              <a
                key={id}
                href={withBase(sampleBrowseHref(id, bgc.assemblySourceType))}
                className="inline-flex max-w-full items-center rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[11px] text-foreground hover:bg-muted"
                target="_blank"
                rel="noopener noreferrer"
                title={`Open ${sampleBrowseLabel(bgc.assemblySourceType)} filtered to ${bgc.sampleLabels[i] || id}`}
              >
                <span className="truncate">{bgc.sampleLabels[i] || id}</span>
              </a>
            ))}
            {hiddenSamples > 0 && (
              <span className="text-[11px] text-muted-foreground">+{hiddenSamples} more</span>
            )}
          </div>
        )}

        <Button asChild variant="outline" size="sm" className="w-full">
          <Link href={`/bgcs/${bgc.id}`}>
            View details
            <ArrowUpRight className="ml-2 h-3 w-3" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
