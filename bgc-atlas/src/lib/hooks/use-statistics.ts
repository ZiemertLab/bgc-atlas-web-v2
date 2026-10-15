import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { ApiResponse } from '@/lib/types';

interface StatisticsPayload {
  totalSamples: number;
  totalAssemblies: number;
  totalBgcs: number;
  totalGcfs: number;
  totalCompleteBgcs?: number;
  totalMetagenomeSamples?: number;
  totalMetagenomeAssemblies?: number;
  totalGenomes?: number;
}

type HookResult = {
  data: ApiResponse<StatisticsPayload>;
  isLoading: boolean;
  error: Error | null;
  hasLoaded: boolean;
};

const EMPTY_STATISTICS: ApiResponse<StatisticsPayload> = {
  success: true,
  message: 'Loading statistics…',
  data: {
    totalSamples: 0,
    totalAssemblies: 0,
    totalBgcs: 0,
    totalGcfs: 0,
    totalCompleteBgcs: 0,
    totalMetagenomeSamples: 0,
    totalMetagenomeAssemblies: 0,
    totalGenomes: 0,
  },
};

const buildUrl = (sourceType?: string | string[]) => {
  const searchParams = new URLSearchParams();
  if (sourceType) {
    if (Array.isArray(sourceType)) {
      sourceType.forEach((t) => searchParams.append('sourceType', t));
    } else {
      searchParams.append('sourceType', sourceType);
    }
  }
  const query = searchParams.toString();
  return `/api/statistics${query ? `?${query}` : ''}`;
};

const normalizeSourceType = (sourceType?: string | string[]) =>
  Array.isArray(sourceType) ? [...sourceType].sort() : sourceType ?? null;

export function useStatistics(sourceType?: string | string[]): HookResult {
  const url = buildUrl(sourceType);

  const { data, error, isLoading, isFetched } = useQuery({
    queryKey: queryKeys.statistics.overall({ sourceType: normalizeSourceType(sourceType) }),
    queryFn: ({ signal }) => apiGet<ApiResponse<StatisticsPayload>>(url, { signal }),
    staleTime: 5 * 60 * 1000,
  });

  return {
    data: data ?? EMPTY_STATISTICS,
    isLoading,
    error: (error as Error | null) ?? null,
    hasLoaded: isFetched,
  };
}
