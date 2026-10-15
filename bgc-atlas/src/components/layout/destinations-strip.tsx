'use client';

import { useEffect, useState } from 'react';

import { StatLinkRow } from '@/components/ui/stat-leader-row';
import { useStatistics } from '@/lib/hooks/use-statistics';

// Client-side because Next prerenders the global not-found at build time.
export function DestinationsStrip() {
  const [mounted, setMounted] = useState(false);
  const { data: statisticsData, isLoading: statsLoading } = useStatistics();
  const statistics = statisticsData?.data || null;

  useEffect(() => {
    setMounted(true);
  }, []);

  const stat = (value?: number | null): string =>
    !mounted || statsLoading ? '—' : (value ?? 0).toLocaleString();

  return (
    <div className="mt-10">
      <div className="section-label mb-2.5 text-center">Where to go</div>
      <ul className="grid grid-cols-1 gap-y-1 text-sm">
        <StatLinkRow
          href="/samples"
          label="Metagenomes"
          value={stat(statistics?.totalMetagenomeSamples)}
        />
        <StatLinkRow
          href="/genome-collections"
          label="Genome Collections"
          value={stat(statistics?.totalGenomes)}
        />
        <StatLinkRow
          href="/bgcs"
          label="Biosynthetic Gene Clusters"
          value={stat(statistics?.totalBgcs)}
        />
        <StatLinkRow
          href="/gcfs"
          label="Gene Cluster Families"
          value={stat(statistics?.totalGcfs)}
        />
      </ul>
    </div>
  );
}
