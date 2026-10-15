import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api-client';

export interface GoldEcosystemDistRow {
  goldLevel1: string | null;
  goldLevel2: string | null;
  goldLevel3: string | null;
  goldLevel4: string | null;
  goldLevel5: string | null;
  bgcCount: number;
  percentage: number;
}

type ApiPayload = {
  success: boolean;
  data?: { distribution: GoldEcosystemDistRow[] };
  error?: string;
};

/** Lazily fetch a GCF's GOLD ecosystem distribution (heavy query, on demand). */
export function useGoldEcosystemDistribution(gcfId: string | null | undefined) {
  const { data, error, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['gcf', 'gold-ecosystem-distribution', gcfId],
    queryFn: async ({ signal }) => {
      const res = await apiGet<ApiPayload>(`/api/gcfs/${gcfId}/gold-ecosystem-distribution`, { signal });
      if (!res.success || !res.data) throw new Error(res.error || 'Failed to fetch GOLD ecosystem distribution');
      return res.data.distribution;
    },
    enabled: Boolean(gcfId),
    staleTime: 5 * 60 * 1000,
  });

  return {
    data: data ?? [],
    isLoading: gcfId ? isLoading : false,
    error: (error as Error | null) ?? null,
    isFetching,
    refetch,
  };
}
