import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { DataSourceStat, DataSourceStatsResponse } from '@/app/api/statistics/data-sources/route';

export type { DataSourceStat };

/** Per-source assembly and BGC counts for the /about table, sorted by assembly count. */
export function useDataSourceStats() {
  const { data, error, isLoading } = useQuery({
    queryKey: queryKeys.statistics.dataSources(),
    queryFn: ({ signal }) =>
      apiGet<DataSourceStatsResponse>('/api/statistics/data-sources', { signal }),
    staleTime: 60 * 60 * 1000,
  });

  return {
    sources: data?.data ?? [],
    isLoading,
    error: error as Error | null,
  };
}
