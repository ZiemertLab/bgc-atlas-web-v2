import { useQuery, keepPreviousData } from '@tanstack/react-query';
import type { FamilyClass } from '@/lib/gcf/family-class';
import { apiGet } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { PaginatedResponse, TaxonomyDistributionByRank } from '@/lib/types';
import type { GcfLengthStats } from '@/lib/utils/bgc-length';

type HookResult<T> = {
  data: PaginatedResponse<T>;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  hasLoaded: boolean;
};

const createEmptyResponse = (params?: { limit?: number; offset?: number }): PaginatedResponse<GcfListItem> => ({
  success: true,
  message: 'No GCFs loaded yet',
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
    // Booleans must not be dropped: `exclusive: true` would silently never reach the URL.
    if (typeof value === 'boolean') {
      if (value) searchParams.set(key, '1');
    }
  });

  const query = searchParams.toString();
  return query ? `?${query}` : '';
};

export type GcfListItem = {
  id: string;
  name: string;
  clusterMethod: string | null;
  // v3 tier: 'seed' (truncation seed) | 'fragmented' (clusters of the leftovers).
  familyClass: 'seed' | 'fragmented' | null;
  representativeBgcId: string | null;
  description: string | null;
  /** Display-only human-readable alias. Not an identifier. */
  petName: string | null;
  memberBgcCount: number;
  assemblyCount: number;
  completeBgcCount: number;
  partialBgcCount: number;
  // BiG-SLiCE distance; lower = more similar.
  avgDistance: number | null;
  minDistance: number | null;
  maxDistance: number | null;
  medianDistance: number | null;
  uniqueProductCategories: number;
  productCategories: string[];
  uniqueTaxaCount: number;
  // Assignment routes: seed / derived / novel.
  seedAssignments: number;
  derivedAssignments: number;
  novelAssignments: number;
  biomeDistributionByLevel: Record<number, Record<string, number>>;
  productCategoryDistribution: Record<string, number>;
  productTypeDistribution: Record<string, number>;
  // Characterized MIBiG references co-clustered into this family. Optional:
  // `undefined` means a document indexed before these fields existed.
  mibigAnchored?: boolean;
  mibigAccessions?: string[];
  mibigCompounds?: string[];
  // Dominant KnownClusterBLAST compound among members, from bgc_facets. A weaker,
  // largely disjoint claim from mibigCompounds; never combine them.
  // null unless >=50% similarity and >=5% of members carry it.
  knownCluster?: {
    accession: string | null;
    compound: string | null;
    /** Best similarity among qualifying members, 0-100. */
    similarity: number;
    /** Members whose qualifying hit is this compound. */
    hitCount: number;
    /** Percent of members carrying it; always >= 5. */
    coverage: number;
  } | null;
  taxonomyDistribution: Record<string, number>;
  taxonomyDistributionByRank: TaxonomyDistributionByRank;
  lengthStats: GcfLengthStats | null;
};

export type UseGcfsParams = {
  limit?: number;
  offset?: number;
  search?: string;
  // Clustering resolution: '0.4' (default) | '0.7'.
  threshold?: '0.4' | '0.7';
  id?: string;
  name?: string;
  minBgcs?: number;
  maxBgcs?: number;
  productType?: string;
  /** Sent as ?category=. */
  category?: string;
  /** Share of members (0-100) that must carry `category`; 0 = any member.
   *  Omitted, `category` is the legacy any-member text match. */
  categoryMinShare?: number;
  biome?: string;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
  ecosystemLevel?: number;
  advancedFilters?: string;
  study?: string;
  /** With `study`, keep only families found in no other study. */
  exclusive?: boolean;
  /** No inverse on purpose: "no curated reference" is not evidence of novelty. */
  mibigAnchored?: boolean;
  familyClass?: FamilyClass;
  // Gates the query without unmounting the hook. /studies/[id] needs it: until the
  // study key loads, an ungated call would ask for the whole family corpus.
  enabled?: boolean;
};

/** The streamed "All matching" export, built by the same function as the list URL. */
export const gcfExportPath = (params: UseGcfsParams): string => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { enabled, limit, offset, ...query } = params;
  return `/api/gcfs/export${buildQueryString(query as Record<string, unknown>)}`;
};

export function useGcfs(params: UseGcfsParams = {}): HookResult<GcfListItem> {
  const { enabled = true, ...queryParams } = params;
  const url = `/api/gcfs${buildQueryString(queryParams as Record<string, unknown>)}`;

  const { data, error, isLoading, isFetching, isFetched } = useQuery({
    queryKey: queryKeys.gcfs.list(queryParams),
    queryFn: ({ signal }) => apiGet<PaginatedResponse<GcfListItem>>(url, { signal }),
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
    enabled,
  });

  if (error) {
    const message = (error as Error).message ?? 'Failed to load GCFs';
    return {
      data: { ...createEmptyResponse({ limit: queryParams.limit, offset: queryParams.offset }), success: false, message },
      isLoading,
      isFetching,
      error: error as Error,
      hasLoaded: isFetched,
    };
  }

  return {
    data: data ?? createEmptyResponse({ limit: queryParams.limit, offset: queryParams.offset }),
    isLoading,
    isFetching,
    error: null,
    hasLoaded: isFetched,
  };
}
