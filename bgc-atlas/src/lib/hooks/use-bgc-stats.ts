import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { ApiResponse } from '@/lib/types';

export type ChartBucket = {
  name: string;
  complete: number;
  partial: number;
};

export type GroupByOption = 'biome' | 'environment' | 'feature' | 'material' | 'gold_level_1' | 'gold_level_2' | 'gold_level_3' | 'gold_level_4' | 'gold_level_5';

export interface BgcStatsPayload {
  bgcCategoryDistribution: ChartBucket[];
  distribution: ChartBucket[];
  meta: {
    groupBy: GroupByOption;
    level?: number;
    limit: number;
  };
}

export interface UseBgcStatsParams {
  groupBy?: GroupByOption;
  level?: number;
  limit?: number;
}

interface HookResult {
  data: ApiResponse<BgcStatsPayload>;
  isLoading: boolean;
  error: Error | null;
}

const DEFAULT_GROUP: GroupByOption = 'biome';
const DEFAULT_LEVEL = 1;
const DEFAULT_LIMIT = 30;

const buildUrl = ({ groupBy, level, limit }: Required<UseBgcStatsParams>): string => {
  const params = new URLSearchParams();
  params.set('groupBy', groupBy);
  if (groupBy === 'biome') {
    params.set('level', String(level));
  }
  if (limit) {
    params.set('limit', String(limit));
  }
  return `/api/statistics/bgcs?${params.toString()}`;
};

const createEmptyPayload = (groupBy: GroupByOption, level: number, limit: number): BgcStatsPayload => ({
  bgcCategoryDistribution: [],
  distribution: [],
  meta: { groupBy, level: groupBy === 'biome' ? level : undefined, limit },
});

export function useBgcStats(
  params: UseBgcStatsParams = {},
  options: { enabled?: boolean } = {},
): HookResult {
  const groupBy = params.groupBy ?? DEFAULT_GROUP;
  const level = params.level ?? DEFAULT_LEVEL;
  const limit = params.limit ?? DEFAULT_LIMIT;
  const enabled = options.enabled ?? true;

  const url = buildUrl({ groupBy, level, limit });
  const placeholder: ApiResponse<BgcStatsPayload> = {
    success: true,
    data: createEmptyPayload(groupBy, level, limit),
    message: 'Loading BGC statistics…',
  };

  const { data, error, isLoading } = useQuery({
    queryKey: queryKeys.statistics.bgcs({ groupBy, level: groupBy === 'biome' ? level : undefined, limit }),
    queryFn: ({ signal }) => apiGet<ApiResponse<BgcStatsPayload>>(url, { signal }),
    staleTime: 5 * 60 * 1000,
    enabled,
  });

  return {
    data: data ?? placeholder,
    isLoading: enabled ? isLoading : false,
    error: (error as Error | null) ?? null,
  };
}
