import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

interface FrontendMapSample {
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
  assemblyCount: number;
  bgcCount: number;
  sourceTypes: string[];
}

interface MapSamplesAPIResponse {
  success: boolean;
  data: FrontendMapSample[];
  total: number;
  limit?: number;
  message?: string;
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
};

export function useGcfMapSamples(gcfId: string | null | undefined): HookResult {
  const { data, error, isLoading, isFetched } = useQuery({
    queryKey: gcfId ? queryKeys.gcfs.mapSamples(gcfId) : ['gcfs', 'map-samples', null],
    queryFn: ({ signal }) =>
      apiGet<MapSamplesAPIResponse>(`/api/gcfs/${gcfId}/samples/map`, { signal }),
    enabled: Boolean(gcfId),
    staleTime: 5 * 60 * 1000,
  });

  if (!gcfId) {
    return { data: DEFAULT_RESPONSE, isLoading: false, error: null, hasLoaded: true };
  }

  return {
    data: data ?? DEFAULT_RESPONSE,
    isLoading,
    error: (error as Error | null) ?? null,
    hasLoaded: isFetched,
  };
}
