'use client';

import dynamic from 'next/dynamic';
import { ChartSkeleton } from '@/components/ui/chart-skeleton';

export const GcfCharts = dynamic(
  () =>
    import('./gcf-charts.client').then((m) => ({
      default: m.GcfCharts,
    })),
  { ssr: false, loading: () => <ChartSkeleton /> }
);
