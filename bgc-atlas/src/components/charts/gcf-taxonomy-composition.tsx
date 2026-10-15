'use client';

import dynamic from 'next/dynamic';
import { ChartSkeleton } from '@/components/ui/chart-skeleton';

export const GcfTaxonomyComposition = dynamic(
  () =>
    import('./gcf-taxonomy-composition.client').then((m) => ({
      default: m.GcfTaxonomyComposition,
    })),
  { ssr: false, loading: () => <ChartSkeleton height={380} /> }
);
