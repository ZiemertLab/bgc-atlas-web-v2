import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { apiGet } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { compositionQueryParams } from '@/lib/opensearch/taxonomy-composition';
import type { DistributionResult, DistributionVariant } from '@/lib/opensearch/bgc-distribution';
import type { UseBgcsParams } from './use-bgcs';

export type DistributionResponse =
  | ({ supported: true } & DistributionResult)
  | { supported: false; reason: string };

/** Takes the same params object the table passes to `useBgcs`, so charts and rows describe the same BGCs. */
export function useBgcDistribution(
  params: UseBgcsParams,
  variant: DistributionVariant,
  options: { enabled?: boolean; withClasses?: boolean } = {},
) {
  const enabled = options.enabled ?? true;
  const query = compositionQueryParams(
    params as Record<string, unknown>,
    options.withClasses ? { variant, classes: 1 } : { variant },
  );
  const url = `/api/bgcs/distribution?${new URLSearchParams(query).toString()}`;

  const { data, error, isLoading, isFetching } = useQuery({
    queryKey: queryKeys.bgcs.distribution(query),
    queryFn: ({ signal }) => apiGet<DistributionResponse>(url, { signal }),
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
