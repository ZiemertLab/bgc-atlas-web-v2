import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

export interface FrontendMapSample {
  id: string;
  externalId: string | null;
  name: string | null;
  location: string | null;
  latitude?: number;
  longitude?: number;
  environmentBiome: string | null;
  goldEcosystemPath: string | null;
  environmentMaterial: string | null;
  environmentFeature: string | null;
  hostScientificName: string | null;
  dataSourceNames: string[];
  studyTitles: string[];
  sourceTypes: string[];
  assemblyCount: number;
  bgcCount: number;
}

interface MapSamplesAPIResponse {
  success: boolean;
  data: FrontendMapSample[];
  total: number;
  missingGeolocation?: number;
  limit?: number;
  message?: string;
}

export interface UseMapSamplesParams {
  // Mirrors the samples-list filter set so the map matches the filtered table.
  search?: string;
  id?: string;
  environment?: string;
  environmentText?: string;
  biome?: string;
  goldEcosystem?: string;
  goldBucket?: string;
  material?: string;
  feature?: string;
  host?: string;
  dataSource?: string;
  study?: string;
  // Exact study_key (the ?studyKey= a study page links with); see use-samples.
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
  advancedFilters?: string;
  sourceType?: string | string[];
  enabled?: boolean;
  limit?: number;
}

type HookResult = {
  data: MapSamplesAPIResponse;
  isLoading: boolean;
  error: Error | null;
  hasLoaded: boolean;
};

const DEFAULT_RESPONSE: MapSamplesAPIResponse = {
  success: true,
  data: [],
  total: 0,
  missingGeolocation: 0,
};

export function useMapSamples(params: UseMapSamplesParams = {}): HookResult {
  const { enabled = true, ...filterParams } = params;

  const searchParams = new URLSearchParams();
  Object.entries(filterParams).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      value.forEach((v) => {
        if (v === undefined || v === null || v === '') return;
        searchParams.append(key, String(v));
      });
      return;
    }
    searchParams.set(key, String(value));
  });
  const query = searchParams.toString();
  const url = `/api/samples/map${query ? `?${query}` : ''}`;

  const { data, error, isLoading, isFetched } = useQuery({
    queryKey: queryKeys.samples.map(filterParams),
    queryFn: ({ signal }) => apiGet<MapSamplesAPIResponse>(url, { signal }),
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  return {
    data: data ?? DEFAULT_RESPONSE,
    isLoading: enabled ? isLoading : false,
    error: (error as Error | null) ?? null,
    hasLoaded: enabled ? isFetched : true,
  };
}
