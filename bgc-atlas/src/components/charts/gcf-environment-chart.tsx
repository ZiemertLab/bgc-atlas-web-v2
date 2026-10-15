'use client';

import dynamic from 'next/dynamic';
import { ChartSkeleton } from '@/components/ui/chart-skeleton';

export const GcfEnvironmentChart = dynamic(
  () =>
    import('./gcf-environment-chart.client').then((m) => ({
      default: m.GcfEnvironmentChart,
    })),
  { ssr: false, loading: () => <ChartSkeleton height={280} /> }
);
