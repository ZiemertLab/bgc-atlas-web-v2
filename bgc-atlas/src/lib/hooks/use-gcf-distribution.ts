import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { apiGet } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { compositionQueryParams } from '@/lib/opensearch/taxonomy-composition';
import type { GcfDistributionResult } from '@/lib/opensearch/gcf-distribution';
import type { UseGcfsParams } from './use-gcfs';

export type GcfDistributionResponse =
  | ({ supported: true } & GcfDistributionResult)
  | { supported: false; reason: string };

/** Takes the same params object the table passes to `useGcfs`, so charts and rows describe the same families. */
export function useGcfDistribution(
  params: UseGcfsParams,
  options: { enabled?: boolean } = {},
) {
  const enabled = options.enabled ?? true;
  // This endpoint has no parameter of its own, hence the empty `own` map.
  const query = compositionQueryParams(params as Record<string, unknown>, {});
  const url = `/api/gcfs/distribution?${new URLSearchParams(query).toString()}`;

  const { data, error, isLoading, isFetching } = useQuery({
    queryKey: queryKeys.gcfs.distribution(query),
    queryFn: ({ signal }) => apiGet<GcfDistributionResponse>(url, { signal }),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
    enabled,
  });

  return {
    data: data?.supported ? data : null,
    // Not an error: the caller falls back to the corpus-wide snapshot.
    unsupported: data?.supported === false ? data.reason : null,
    isLoading: enabled ? isLoading : false,
    isFetching,
    error: error as Error | null,
  };
}
