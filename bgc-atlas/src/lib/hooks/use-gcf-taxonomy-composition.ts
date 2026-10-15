import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { apiGet } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { TaxonomyRank } from '@/lib/types';
import { compositionQueryParams } from '@/lib/opensearch/taxonomy-composition';
import type { GcfCompositionResult, PurityCutoff } from '@/lib/opensearch/gcf-taxonomy-composition';
import type { UseGcfsParams } from './use-gcfs';

export type GcfTaxonomyCompositionResponse =
  | ({ supported: true } & GcfCompositionResult)
  | { supported: false; reason: string };

/**
 * Takes the same params object the table passes to `useGcfs`, including
 * `threshold`: the index holds only 0.4, so at 0.7 the server reports the panel unsupported.
 */
export function useGcfTaxonomyComposition(
  params: UseGcfsParams,
  rank: TaxonomyRank,
  purity: PurityCutoff,
) {
  const query = compositionQueryParams(params as Record<string, unknown>, { rank, purity });
  const url = `/api/gcfs/taxonomy-composition?${new URLSearchParams(query).toString()}`;

  const { data, error, isLoading, isFetching } = useQuery({
    queryKey: queryKeys.gcfs.taxonomyComposition(query),
    queryFn: ({ signal }) => apiGet<GcfTaxonomyCompositionResponse>(url, { signal }),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
  });

  return {
    data: data?.supported ? data : null,
    // An unsupported filter set is not an error — the panel hides itself.
    unsupported: data?.supported === false ? data.reason : null,
    isLoading,
    isFetching,
    error: error as Error | null,
  };
}
