import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

export type ProductDistribution = {
  category: string;
  count: number;
};

export type SizeDistribution = {
  range: string;
  count: number;
};

export type RawSizeDistribution = {
  size: number;
  count: number;
};

export type GcfStats = {
  categoryDistribution: ProductDistribution[];
  sizeDistribution: SizeDistribution[];
  fullSizeDistribution: RawSizeDistribution[];
};

type ApiResponse = {
  success: boolean;
  data?: GcfStats;
  error?: string;
  message: string;
};

type HookResult = {
  data: GcfStats | null;
  isLoading: boolean;
  error: Error | null;
};

export function useGcfStats(options: { enabled?: boolean } = {}): HookResult {
  const enabled = options.enabled ?? true;
  const { data, error, isLoading } = useQuery({
    queryKey: queryKeys.statistics.gcfs({ v: 3 }),
    queryFn: async ({ signal }) => {
      const response = await apiGet<ApiResponse>('/api/gcfs/stats', { signal });
      if (!response.success || !response.data) {
        throw new Error(response.message || 'Failed to load GCF statistics');
      }
      return response.data;
    },
    staleTime: 5 * 60 * 1000,
    enabled,
  });

  return {
    data: data ?? null,
    isLoading: enabled ? isLoading : false,
    error: (error as Error | null) ?? null,
  };
}
