import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { GcfLengthStats } from '@/lib/utils/bgc-length';

export type GcfDetail = {
  id: string;
  name: string;
  clusterMethod: string | null;
  // v3 tier: 'seed' (truncation seed) | 'fragmented' (clusters of the leftovers).
  familyClass: 'seed' | 'fragmented' | null;
  // Display-only alias, not an identifier.
  petName: string | null;
  description: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;

  memberBgcCount: number;
  assemblyCount: number;
  completeBgcCount: number;
  partialBgcCount: number;
  lengthStats: GcfLengthStats | null;

  // BiG-SLiCE distances; lower = more similar.
  avgDistance: number | null;
  minDistance: number | null;
  maxDistance: number | null;
  medianDistance: number | null;

  uniqueProductCategories: number;
  productCategories: string[];
  /** Overlapping: a hybrid counts under each category, so these sum past memberBgcCount. */
  categoryMembers: { category: string; bgcCount: number }[];
  /** Members per exact category set ('NRPS+PKS'); a partition. */
  categoryCombinations: { combination: string; bgcCount: number }[];

  uniqueTaxaCount: number;
  taxonomySummary?: {
    totalBgcsWithTaxonomy: number;
    totalBgcsWithoutTaxonomy: number;
    coveragePercentage: number;
    uniqueDomains: number;
    uniquePhyla: number;
    uniqueClasses: number;
    uniqueOrders: number;
    uniqueFamilies: number;
    uniqueGenera: number;
    uniqueSpecies: number;
  };

  // Assignment routes: seed / derived / novel.
  seedAssignments: number;
  derivedAssignments: number;
  novelAssignments: number;
  // From gcf_route_counts_mv; only the detail route selects them.
  containedAssignments?: number;
  orphanQueryAssignments?: number;

  firstBgcAdded: Date | string | null;
  lastBgcAdded: Date | string | null;

  representativeBgc: {
    id: string;
    name: string;
    productCategory: string[];
    productType: string[];
    isComplete: boolean;
    length: number;
    genes: number | null;
    assembly: string;
    /** antiSMASH region anchor (`r<record>c<region>`); null when the representative
     *  cannot be located in the run. */
    anchor: string | null;
  } | null;

  environmentalDistribution: Array<{
    biomeLevel1: string | null;
    biomeLevel2: string | null;
    biomeLevel3: string | null;
    bgcCount: number;
    percentage: number;
  }>;

  productTypeDistribution: Array<{
    productCategory: string;
    productType: string;
    bgcCount: number;
  }>;

  // MIBiG references that are members of this family (distance <= 0.4), nearest
  // first. Usually empty. Optional, not defaulted to [], so a shape slip is not
  // read as "no characterized relative".
  mibigAnchors?: Array<{
    accession: string;
    compounds: string[];
    chemClasses: string[];
    producer: string | null;
    // MIBiG 4.x serves versioned accessions only; the repository URL 404s without it.
    mibigVersion: number | null;
    status: string | null;
    // Lower = better.
    distance: number | null;
  }>;

  sourceTypeDistribution: Array<{
    sourceType: string;
    assemblyCount: number;
    bgcCount: number;
    // BiG-SLiCE distance; lower = more similar.
    avgDistance: number | null;
  }>;

  // Loaded lazily via its own endpoint.
  goldEcosystemDistribution?: Array<{
    goldLevel1: string | null;
    goldLevel2: string | null;
    goldLevel3: string | null;
    goldLevel4: string | null;
    goldLevel5: string | null;
    bgcCount: number;
    percentage: number;
  }>;
};

type ApiResponse = {
  success: boolean;
  data?: GcfDetail;
  error?: string;
  message: string;
};

type HookResult = {
  data: GcfDetail | null;
  isLoading: boolean;
  error: Error | null;
  hasLoaded: boolean;
};

export function useGcfDetail(gcfId: string | null | undefined): HookResult {
  const { data, error, isLoading, isFetched } = useQuery({
    queryKey: gcfId ? queryKeys.gcfs.detail(gcfId) : ['gcfs', 'detail', null],
    queryFn: async ({ signal }) => {
      const response = await apiGet<ApiResponse>(`/api/gcfs/${gcfId}`, { signal });
      if (!response.success || !response.data) {
        throw new Error(response.message || 'Failed to load GCF details');
      }
      return response.data;
    },
    enabled: Boolean(gcfId),
    staleTime: 5 * 60 * 1000,
  });

  if (!gcfId) {
    return { data: null, isLoading: false, error: null, hasLoaded: false };
  }

  return {
    data: data ?? null,
    isLoading,
    error: (error as Error | null) ?? null,
    hasLoaded: isFetched,
  };
}
