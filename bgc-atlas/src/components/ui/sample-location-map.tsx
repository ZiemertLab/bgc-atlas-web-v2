'use client';

import dynamic from 'next/dynamic';

export const SampleLocationMap = dynamic(() => import('./sample-location-map.client'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[280px] w-full items-center justify-center rounded-md border border-border bg-card text-sm text-muted-foreground">
      Loading map…
    </div>
  ),
});
