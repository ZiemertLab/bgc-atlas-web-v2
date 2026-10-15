'use client';

import dynamic from 'next/dynamic';
import { ChartSkeleton } from '@/components/ui/chart-skeleton';

export const BgcCharts = dynamic(
  () =>
    import('./BgcCharts.client').then((m) => ({
      default: m.BgcCharts,
    })),
  { ssr: false, loading: () => <ChartSkeleton /> }
);
