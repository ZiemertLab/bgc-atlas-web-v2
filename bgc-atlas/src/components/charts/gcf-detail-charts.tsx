'use client';

import dynamic from 'next/dynamic';
import { ChartSkeleton } from '@/components/ui/chart-skeleton';

export const ProductTypeChart = dynamic(
  () =>
    import('./gcf-detail-charts.client').then((m) => ({
      default: m.ProductTypeChart,
    })),
  { ssr: false, loading: () => <ChartSkeleton /> }
);

export const GoldEcosystemChart = dynamic(
  () =>
    import('./gcf-detail-charts.client').then((m) => ({
      default: m.GoldEcosystemChart,
    })),
  { ssr: false, loading: () => <ChartSkeleton /> }
);

export const SourceTypeChart = dynamic(
  () =>
    import('./gcf-detail-charts.client').then((m) => ({
      default: m.SourceTypeChart,
    })),
  { ssr: false, loading: () => <ChartSkeleton /> }
);

export const MembershipScoreChart = dynamic(
  () =>
    import('./gcf-detail-charts.client').then((m) => ({
      default: m.MembershipScoreChart,
    })),
  { ssr: false, loading: () => <ChartSkeleton /> }
);
