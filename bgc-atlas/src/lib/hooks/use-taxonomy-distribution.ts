import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { TaxonomyDistributionResponse } from '@/lib/types';

type ApiPayload = {
  success: boolean;
  data?: TaxonomyDistributionResponse;
  message?: string;
};

export function useTaxonomyDistribution(gcfId: string | null | undefined) {
  const { data, error, isLoading } = useQuery({
    queryKey: gcfId ? queryKeys.taxonomy.distribution({ gcfId }) : ['taxonomy', 'distribution', null],
    queryFn: async ({ signal }) => {
      const response = await apiGet<ApiPayload>(`/api/gcfs/${gcfId}/taxonomy-distribution`, { signal });
      if (!response.success || !response.data) {
        throw new Error(response.message || 'Failed to fetch taxonomy data');
      }
      return response.data;
    },
    enabled: Boolean(gcfId),
    staleTime: 5 * 60 * 1000,
  });

  if (!gcfId) {
    return { data: null, isLoading: false, error: null };
  }

  return {
    data: (data ?? null) as TaxonomyDistributionResponse | null,
    isLoading,
    error: (error as Error | null) ?? null,
  };
}
