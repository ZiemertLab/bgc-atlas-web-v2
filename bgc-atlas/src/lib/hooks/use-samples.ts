import { useQuery, keepPreviousData, type UseQueryOptions } from '@tanstack/react-query';
import { apiGet } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

import type { PaginatedResponse, Sample, SampleMeasurementsResponse, SampleStudiesResponse } from '@/lib/types';

const API_DISABLED_MESSAGE = 'Data not yet loaded.';

type HookResult<T> = {
  data: T;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  hasLoaded: boolean;
};

const createEmptyPaginatedResponse = <T>(params?: { limit?: number; offset?: number }): PaginatedResponse<T> => ({
  success: true,
  message: API_DISABLED_MESSAGE,
  data: {
    data: [],
    total: 0,
    limit: params?.limit ?? 0,
    offset: params?.offset ?? 0,
  },
});

const buildQueryString = (params?: Record<string, unknown>) => {
  const searchParams = new URLSearchParams();

  if (!params) return '';

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      searchParams.set(key, String(value));
      return;
    }
    if (typeof value === 'string') {
      searchParams.set(key, value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((v) => searchParams.append(key, String(v)));
    }
  });

  const query = searchParams.toString();
  return query ? `?${query}` : '';
};

const createEmptyStudiesResponse = (
  message = API_DISABLED_MESSAGE,
  success = true
): SampleStudiesResponse => ({
  success,
  message,
  data: [],
  total: 0,
  summary: {
    total_studies: 0,
    study_types: [],
    total_related_samples: 0,
    all_biomes: [],
    center_names: [],
    bioprojects: [],
  },
});

const createEmptyMeasurementsResponse = (
  message = API_DISABLED_MESSAGE,
  success = true
): SampleMeasurementsResponse => ({
  success,
  message,
  data: { measurements: [], measurements_by_key: {} },
  pagination: { total: 0, limit: 0, offset: 0, has_more: false },
  summary: {
    total_measurements: 0,
    total_in_database: 0,
    unique_keys: 0,
    unique_sources: [],
    date_range: { earliest: null, latest: null },
    key_statistics: [],
  },
  filters: {},
});

function withFallback<T>(
  result: ReturnType<typeof useQuery<T, Error>>,
  fallback: T
): HookResult<T> {
  return {
    data: result.data ?? fallback,
    isLoading: result.isLoading,
    isFetching: result.isFetching,
    error: (result.error as Error | null) ?? null,
    // Placeholder rows (keepPreviousData while a new key fetches) count as loaded;
    // otherwise the table swaps to a skeleton on every filter keystroke.
    hasLoaded: result.isFetched || result.isPlaceholderData,
  };
}

export type UseSamplesParams = {
  limit?: number;
  offset?: number;
  environment?: string;
  biome?: string;
  goldEcosystem?: string;
  goldBucket?: string;
  search?: string;
  sortField?: string;
  sortOrder?: string;
  id?: string;
  environmentText?: string;
  material?: string;
  feature?: string;
  host?: string;
  dataSource?: string;
  study?: string;
  // Exact study_key; distinct from `study` because 710 titles are shared by more than one study.
  studyKey?: string;
  latMin?: number;
  latMax?: number;
  lonMin?: number;
  lonMax?: number;
  assembliesMin?: number;
  assembliesMax?: number;
  bgcsMin?: number;
  bgcsMax?: number;
  // Distinct GCFs at threshold 0.4 (sample_gcf_counts_mv).
  gcfsMin?: number;
  gcfsMax?: number;
  sourceType?: string | string[];
  advancedFilters?: string;
  includeGtdbAccession?: number;
  includeTaxonomy?: number;
  includeStudyLinks?: number;
  // Gates the query without unmounting the hook.
  enabled?: boolean;
};

/**
 * The streamed "All matching" export. `view` picks the table the file mirrors:
 * /samples and /genome-collections share one endpoint but show different columns.
 */
export const sampleExportPath = (
  params: UseSamplesParams, view: 'metagenomes' | 'genomes',
): string => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { enabled, limit, offset, ...query } = params as UseSamplesParams & { enabled?: boolean };
  return `/api/samples/export${buildQueryString({ ...query, view } as Record<string, unknown>)}`;
};

export function useSamples(params: UseSamplesParams = {}): HookResult<PaginatedResponse<Sample>> {
  const { enabled = true, ...queryParams } = params;
  const url = `/api/samples${buildQueryString(queryParams as Record<string, unknown>)}`;
  const fallback = createEmptyPaginatedResponse<Sample>(queryParams);

  const result = useQuery<PaginatedResponse<Sample>, Error>({
    queryKey: queryKeys.samples.list({
      ...queryParams,
      sourceType: Array.isArray(queryParams.sourceType) ? [...queryParams.sourceType].sort() : queryParams.sourceType,
    }),
    queryFn: ({ signal }) => apiGet<PaginatedResponse<Sample>>(url, { signal }),
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
    enabled,
  });

  return withFallback(result, fallback);
}

// One row per assembly (the Samples page "Assemblies" view).
export function useAssemblies(params: UseSamplesParams = {}): HookResult<PaginatedResponse<Sample>> {
  const { enabled = true, ...queryParams } = params;
  const url = `/api/assemblies${buildQueryString(queryParams as Record<string, unknown>)}`;
  const fallback = createEmptyPaginatedResponse<Sample>(queryParams);

  const result = useQuery<PaginatedResponse<Sample>, Error>({
    queryKey: ['assemblies', 'list', {
      ...queryParams,
      sourceType: Array.isArray(queryParams.sourceType) ? [...queryParams.sourceType].sort() : queryParams.sourceType,
    }],
    queryFn: ({ signal }) => apiGet<PaginatedResponse<Sample>>(url, { signal }),
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
    enabled,
  });

  return withFallback(result, fallback);
}

function useResource<T>(
  id: string | null | undefined,
  buildKey: (id: string) => readonly unknown[],
  buildPath: (id: string) => string,
  emptyResponse: T,
  emptyNoIdResponse: T,
  options?: Partial<UseQueryOptions<T, Error>>
): HookResult<T> {
  const result = useQuery<T, Error>({
    queryKey: id ? buildKey(id) : ['__samples_disabled__', String(id ?? '')],
    queryFn: ({ signal }) => apiGet<T>(buildPath(id as string), { signal }),
    enabled: Boolean(id),
    staleTime: 5 * 60 * 1000,
    ...options,
  });

  if (!id) {
    return {
      data: emptyNoIdResponse,
      isLoading: false,
      isFetching: false,
      error: null,
      hasLoaded: true,
    };
  }

  return withFallback(result, emptyResponse);
}

export function useSampleStudies(id: string | null | undefined): HookResult<SampleStudiesResponse> {
  return useResource<SampleStudiesResponse>(
    id,
    (sid) => ['samples', 'studies', sid] as const,
    (sid) => `/api/samples/${sid}/studies`,
    createEmptyStudiesResponse(),
    createEmptyStudiesResponse('No sample selected.', false)
  );
}

export function useSampleMeasurements(
  id: string | null | undefined,
  params?: {
    key?: string;
    source?: string;
    minDate?: string;
    maxDate?: string;
    limit?: number;
    offset?: number;
  }
): HookResult<SampleMeasurementsResponse> {
  const query = buildQueryString(params as Record<string, unknown> | undefined);
  return useResource<SampleMeasurementsResponse>(
    id,
    (sid) => ['samples', 'measurements', sid, params ?? {}] as const,
    (sid) => `/api/samples/${sid}/measurements${query}`,
    createEmptyMeasurementsResponse(),
    createEmptyMeasurementsResponse('No sample selected.', false)
  );
}
