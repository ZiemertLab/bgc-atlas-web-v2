'use client';

import dynamic from 'next/dynamic';
import { ChartSkeleton } from '@/components/ui/chart-skeleton';

export const SampleCharts = dynamic(
  () =>
    import('./SampleCharts.client').then((m) => ({
      default: m.SampleCharts,
    })),
  { ssr: false, loading: () => <ChartSkeleton /> }
);
