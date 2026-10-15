'use client';

import dynamic from 'next/dynamic';
import { ChartSkeleton } from '@/components/ui/chart-skeleton';

export const GenomeCharts = dynamic(
  () =>
    import('./GenomeCharts.client').then((m) => ({
      default: m.GenomeCharts,
    })),
  { ssr: false, loading: () => <ChartSkeleton /> }
);
