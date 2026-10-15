import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { GcfStatisticsResponse } from '@/app/api/statistics/gcfs/route';

type HookResult = {
  data: GcfStatisticsResponse;
  isLoading: boolean;
  error: Error | null;
  hasLoaded: boolean;
};

const EMPTY_STATISTICS: GcfStatisticsResponse = {
  success: true,
  message: 'Loading statistics...',
  data: {
    totalGcfs: 0,
    totalMemberBgcs: 0,
    avgMemberBgcs: 0,
    totalCompleteBgcs: 0,
    totalAssemblies: 0,
    avgTaxaCount: 0,
  },
};

export function useGcfStatistics(): HookResult {
  const { data, error, isLoading, isFetched } = useQuery({
    // The marker keeps a cached v2 entry (a different payload shape) from being read back.
    queryKey: queryKeys.statistics.gcfsMeta({ v: 3 }),
    queryFn: ({ signal }) =>
      apiGet<GcfStatisticsResponse>('/api/statistics/gcfs', { signal }),
    staleTime: 5 * 60 * 1000,
  });

  return {
    data: data ?? EMPTY_STATISTICS,
    isLoading,
    error: (error as Error | null) ?? null,
    hasLoaded: isFetched,
  };
}
