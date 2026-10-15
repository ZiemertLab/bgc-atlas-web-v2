import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@/lib/api-client';

export interface SequenceMapSample {
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

interface Response {
  success: boolean;
  data: SequenceMapSample[];
  total: number;
  limit?: number;
  error?: string;
}

export interface SequenceMapFilters {
  minIdentity?: number;
  minCoverage?: number;
  queryFrom?: number;
  queryTo?: number;
}

const EMPTY: Response = { success: true, data: [], total: 0 };

/** `enabled` follows the panel's disclosure state: the sample set is derived per request. */
export function useSequenceMapSamples(
  sessionId: string,
  filters: SequenceMapFilters,
  enabled: boolean
) {
  const params = new URLSearchParams();
  if (filters.minIdentity !== undefined) params.set('minIdentity', String(filters.minIdentity));
  if (filters.minCoverage !== undefined) params.set('minCoverage', String(filters.minCoverage));
  if (filters.queryFrom !== undefined) params.set('queryFrom', String(filters.queryFrom));
  if (filters.queryTo !== undefined) params.set('queryTo', String(filters.queryTo));
  const query = params.toString();

  const result = useQuery<Response, Error>({
    queryKey: ['sequence-search', 'map-samples', sessionId, query],
    queryFn: ({ signal }) =>
      apiGet<Response>(
        `/api/search/sequence/${sessionId}/samples/map${query ? `?${query}` : ''}`,
        { signal }
      ),
    enabled: enabled && Boolean(sessionId),
    staleTime: 5 * 60 * 1000,
  });

  return {
    data: result.data ?? EMPTY,
    isLoading: result.isLoading,
    error: (result.error as Error | null) ?? null,
    hasLoaded: result.isFetched,
  };
}
