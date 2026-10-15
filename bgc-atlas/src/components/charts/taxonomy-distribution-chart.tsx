'use client';

import dynamic from 'next/dynamic';
import { ChartSkeleton } from '@/components/ui/chart-skeleton';

export const TaxonomyDistributionChart = dynamic(
  () =>
    import('./taxonomy-distribution-chart.client').then((m) => ({
      default: m.TaxonomyDistributionChart,
    })),
  { ssr: false, loading: () => <ChartSkeleton /> }
);
