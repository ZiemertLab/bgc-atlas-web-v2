'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useTaxonomyDistribution } from '@/lib/hooks/use-taxonomy-distribution';

// Shares the chart's lazily fetched endpoint (React Query dedups), so it adds no load to the
// page-blocking GCF request.
export function TaxonomySummaryCards({ gcfId }: { gcfId: string }) {
  const { data } = useTaxonomyDistribution(gcfId);
  const summary = data?.summary;
  if (!summary) return null;

  return (
    <div className="mb-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">BGCs with Taxonomy</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.totalBgcsWithTaxonomy.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">{summary.coveragePercentage.toFixed(1)}% coverage</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Unique Domains</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.uniqueDomains}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Unique Phyla</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.uniquePhyla}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Unique Genera</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.uniqueGenera}</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
