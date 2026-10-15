import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { ApiResponse } from '@/lib/types';

export type SampleChartBucket = {
  name: string;
  samples: number;
  bgcs: number;
};

export type SampleGroupByOption = 'biome' | 'environment' | 'feature' | 'material' | 'gold_level_1' | 'gold_level_2' | 'gold_level_3' | 'gold_level_4' | 'gold_level_5';

export interface SampleStatsPayload {
  distribution: SampleChartBucket[];
  meta: {
    groupBy: SampleGroupByOption;
    limit: number;
  };
}

export interface UseSampleStatsParams {
  groupBy?: SampleGroupByOption;
  limit?: number;
  search?: string;
  id?: string;
  environmentText?: string;
  material?: string;
  feature?: string;
  host?: string;
  dataSource?: string;
  study?: string;
  latMin?: number;
  latMax?: number;
  lonMin?: number;
  lonMax?: number;
  assembliesMin?: number;
  assembliesMax?: number;
  bgcsMin?: number;
  bgcsMax?: number;
  sourceType?: string | string[];
}

interface HookResult {
  data: ApiResponse<SampleStatsPayload>;
  isLoading: boolean;
  error: Error | null;
}

const DEFAULT_GROUP: SampleGroupByOption = 'biome';
const DEFAULT_LIMIT = 20;

const buildUrl = (params: UseSampleStatsParams): string => {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      value.forEach(v => searchParams.append(key, String(v)));
    } else {
      searchParams.set(key, String(value));
    }
  });

  if (!searchParams.has('groupBy')) searchParams.set('groupBy', DEFAULT_GROUP);
  if (!searchParams.has('limit')) searchParams.set('limit', String(DEFAULT_LIMIT));

  return `/api/statistics/samples?${searchParams.toString()}`;
};

const createEmptyPayload = (groupBy: SampleGroupByOption, limit: number): SampleStatsPayload => ({
  distribution: [],
  meta: { groupBy, limit },
});

export type SampleHierarchyRow = { path: string; samples: number; bgcs: number };
export interface SampleHierarchyPayload {
  hierarchy: SampleHierarchyRow[];
}

const buildHierarchyUrl = (params: UseSampleStatsParams & Record<string, unknown>): string => {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (key === 'groupBy' || key === 'limit') return; // not used by the hierarchy endpoint
    if (Array.isArray(value)) {
      value.forEach(v => searchParams.append(key, String(v)));
    } else {
      searchParams.set(key, String(value));
    }
  });
  const qs = searchParams.toString();
  return `/api/statistics/samples/hierarchy${qs ? `?${qs}` : ''}`;
};

export function useSampleHierarchy(
  params: UseSampleStatsParams & Record<string, unknown> = {},
  options: { enabled?: boolean } = {},
): { data: ApiResponse<SampleHierarchyPayload> | undefined; isLoading: boolean; error: Error | null } {
  const enabled = options.enabled ?? true;
  const url = buildHierarchyUrl(params);
  const { data, error, isLoading } = useQuery({
    queryKey: ['statistics', 'samples', 'hierarchy', url],
    queryFn: ({ signal }) => apiGet<ApiResponse<SampleHierarchyPayload>>(url, { signal }),
    staleTime: 5 * 60 * 1000,
    enabled,
  });
  return { data, isLoading: enabled ? isLoading : false, error: (error as Error | null) ?? null };
}

export function useSampleStats(
  params: UseSampleStatsParams = {},
  options: { enabled?: boolean } = {},
): HookResult {
  const groupBy = params.groupBy ?? DEFAULT_GROUP;
  const limit = params.limit ?? DEFAULT_LIMIT;
  const enabled = options.enabled ?? true;

  const url = buildUrl(params);
  const placeholder: ApiResponse<SampleStatsPayload> = {
    success: true,
    data: createEmptyPayload(groupBy, limit),
    message: 'Loading sample statistics…',
  };

  const { data, error, isLoading } = useQuery({
    queryKey: queryKeys.statistics.samples({
      ...params,
      sourceType: Array.isArray(params.sourceType) ? [...params.sourceType].sort() : params.sourceType,
    }),
    queryFn: ({ signal }) => apiGet<ApiResponse<SampleStatsPayload>>(url, { signal }),
    staleTime: 5 * 60 * 1000,
    enabled,
  });

  return {
    data: data ?? placeholder,
    isLoading: enabled ? isLoading : false,
    error: (error as Error | null) ?? null,
  };
}
