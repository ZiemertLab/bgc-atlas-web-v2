"use client";

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FragmentedBadge } from '@/components/ui/fragmented-badge';
import { ProductCategoryChart } from '@/components/ui/product-category-chart';
import { ArrowRight } from 'lucide-react';
import type { GcfListItem } from '@/lib/hooks/use-gcfs';
import { formatBgcLength } from '@/lib/utils/bgc-length';

interface GcfCardProps {
  gcf: GcfListItem;
}

export function GcfCard({ gcf }: GcfCardProps) {
  const length = formatBgcLength(gcf.lengthStats);

  return (
    <Card className="transition-colors hover:border-foreground/30">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="min-w-0 flex-1 truncate font-mono text-sm">
            {gcf.name}
          </CardTitle>
          <div className="flex shrink-0 items-center gap-1">
            {gcf.familyClass === 'fragmented' && <FragmentedBadge trigger="tap" />}
          </div>
        </div>
        <div className="truncate font-mono text-xs text-muted-foreground">
          {gcf.petName ? (
            // The sr-only prefix is the accessible name: aria-label on a bare span is
            // dropped, and `title` never fires on touch.
            <span title="Human-readable alias — for recall only, not an identifier">
              <span className="sr-only">Alias: </span>
              {gcf.petName}
            </span>
          ) : (
            `${gcf.id.slice(0, 16)}…`
          )}
        </div>
      </CardHeader>
      <CardContent>
        <dl className="mb-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Member BGCs</dt>
            <dd className="font-mono font-medium tabular-nums">
              {gcf.memberBgcCount.toLocaleString()}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Assemblies</dt>
            <dd className="font-mono font-medium tabular-nums">
              {gcf.assemblyCount.toLocaleString()}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Length</dt>
            <dd
              className={`font-mono font-medium tabular-nums ${length?.isBound ? 'text-muted-foreground' : ''}`}
              title={length?.tooltip}
            >
              {length?.text ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Avg distance</dt>
            <dd className="font-mono text-xs tabular-nums">
              {gcf.avgDistance?.toFixed(3) ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Taxa</dt>
            <dd className="font-mono font-medium tabular-nums">
              {gcf.uniqueTaxaCount.toLocaleString()}
            </dd>
          </div>
        </dl>

        {/* Members by exact category combination, as in the table's distribution column. */}
        {Object.keys(gcf.productCategoryDistribution ?? {}).length > 0 && (
          <div className="mb-3">
            <div className="mb-1 text-xs text-muted-foreground">
              Category distribution
            </div>
            <ProductCategoryChart
              distribution={gcf.productCategoryDistribution}
              height={20}
              valueLabel="of members"
            />
          </div>
        )}

        <Link href={`/gcfs/${gcf.id}`}>
          <Button variant="outline" size="sm" className="w-full">
            View details
            <ArrowRight className="size-3" />
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
