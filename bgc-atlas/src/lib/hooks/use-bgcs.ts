import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { apiGet } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { PaginatedResponse } from '@/lib/types';

const API_DISABLED_MESSAGE = 'BGC listings unavailable while API is rebuilt.';

type HookResult<T> = {
  data: PaginatedResponse<T>;
  isLoading: boolean;
  /** Also true during refetches, while `placeholderData` keeps the previous data on screen. */
  isFetching: boolean;
  error: Error | null;
  hasLoaded: boolean;
};

export type BgcListItem = {
  // KnownClusterBLAST hit against MIBiG, attached from bgc_facets (not in bgc_browse).
  // null when no hit reaches the 50% similarity threshold (~94% of regions).
  knownCluster?: {
    accession: string | null;
    compound: string | null;
    similarity: number;
  } | null;
  id: string;
  assemblyDisplay: string | null;
  assembly: string;
  assemblySourceType: string;
  name: string;
  category: string | null;
  categories: string[];
  products: string[];
  completeness: 'complete' | 'partial' | 'unknown';
  length: number | null;
  genes: number | null;
  gcf: string | null;
  gcfName: string | null;
  // BiG-SLiCE distance to the GCF; lower = more similar.
  distance: number | null;
  biome: string | null;
  biomeLevels: string[];
  biomeEnvironment: string[];
  antismashRunId: string | null;
  anchor: string | null;
  sampleIds: string[];
  sampleLabels: string[];
  dataSourceNames: string[];
  goldEcosystemPath: string | null;
  taxonomyDomain: string | null;
  taxonomyPhylum: string | null;
  taxonomyClass: string | null;
  taxonomyOrder: string | null;
  taxonomyFamily: string | null;
  taxonomyGenus: string | null;
  taxonomySpecies: string | null;
  gtdbLineage: string | null;
};

const createEmptyResponse = (params?: { limit?: number; offset?: number }): PaginatedResponse<BgcListItem> => ({
  success: true,
  message: API_DISABLED_MESSAGE,
  data: {
    data: [],
    total: 0,
    limit: params?.limit ?? 0,
    offset: params?.offset ?? 0,
  },
});

const buildQueryString = (params: Record<string, unknown>) => {
  const searchParams = new URLSearchParams();

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
    }
  });

  const query = searchParams.toString();
  return query ? `?${query}` : '';
};

export type UseBgcsParams = {
  limit?: number;
  offset?: number;
  search?: string;
  type?: string;
  class?: string;
  sampleId?: string;
  gcfId?: string;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
  sortFields?: string[];
  sortOrders?: ('asc' | 'desc')[];
  id?: string;
  name?: string;
  biome?: string;
  sample?: string;
  dataSource?: string;
  assembly?: string;
  gcf?: string;
  product?: string;
  completeness?: string;
  lengthMin?: number;
  lengthMax?: number;
  genesMin?: number;
  genesMax?: number;
  // BiG-SLiCE distance range; lower = more similar.
  distanceMin?: number;
  distanceMax?: number;
  taxonomy?: string;
  goldEcosystem?: string;
  latMin?: string;
  latMax?: string;
  lonMin?: string;
  lonMax?: string;
  goldBucket?: string;
  advancedFilters?: string;
};

const normalizeBgcParams = (params: UseBgcsParams): Record<string, unknown> => {
  const normalizedParams: Record<string, unknown> = { ...params };
  if (params.sortFields?.length) {
    normalizedParams.sortFields = params.sortFields.join(',');
  } else {
    delete normalizedParams.sortFields;
  }
  if (params.sortOrders?.length) {
    normalizedParams.sortOrders = params.sortOrders.join(',');
  } else {
    delete normalizedParams.sortOrders;
  }
  return normalizedParams;
};

/** The streamed "All matching" export, built by the same normalisation as the list URL. */
export const bgcExportPath = (params: UseBgcsParams): string => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { limit, offset, ...query } = params;
  return `/api/bgcs/export${buildQueryString(normalizeBgcParams(query))}`;
};

export function useBgcs(params: UseBgcsParams = {}): HookResult<BgcListItem> {
  const normalizedParams = normalizeBgcParams(params);

  const url = `/api/bgcs${buildQueryString(normalizedParams)}`;

  const { data, error, isLoading, isFetching, isFetched } = useQuery({
    queryKey: queryKeys.bgcs.list(normalizedParams),
    queryFn: ({ signal }) => apiGet<PaginatedResponse<BgcListItem>>(url, { signal }),
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
  });

  if (error) {
    const message = (error as Error).message ?? 'Failed to load BGCs';
    return {
      data: { ...createEmptyResponse({ limit: params.limit, offset: params.offset }), success: false, message },
      isLoading,
      isFetching,
      error: error as Error,
      hasLoaded: isFetched,
    };
  }

  return {
    data: data ?? createEmptyResponse({ limit: params.limit, offset: params.offset }),
    isLoading,
    isFetching,
    error: null,
    hasLoaded: isFetched,
  };
}
