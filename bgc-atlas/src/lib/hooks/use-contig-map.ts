import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@/lib/api-client';
import type { GeneKind } from '@/lib/seqsearch/genbank';

export interface ContigLocus {
  /** The contig this is drawn on; not the same as queryId for a GenBank CDS search. */
  contig: string | null;
  queryId: string | null;
  start: number;
  end: number;
  strand: '+' | '-';
  hits: number;
  bgcs: number;
  avgIdentity: number;
  bestBitScore: number;
  /** Depth is a floor rather than a total, because this query hit the result cap. */
  truncated: boolean;
}

export interface ContigHit {
  contig: string | null;
  groupKey: string;
  queryId: string | null;
  start: number;
  end: number;
  strand: '+' | '-';
  identity: number;
  bitScore: number;
  bgcId: string | null;
  bgcFilename: string | null;
  cdsLabel: string;
}

export interface QueryGene {
  locusTag: string;
  start: number;
  end: number;
  strand: '+' | '-';
  isCore: boolean;
  /** antiSMASH /gene_kind; absent on genes outside a detected region. */
  geneKind?: GeneKind;
  product?: string;
  hits: number;
  bgcs: number;
  bestBitScore: number;
  /** Depth is a floor rather than a total, because this query hit the result cap. */
  truncated: boolean;
}

export interface ContigMapData {
  /** The query's own genes, when a GenBank record was searched by its CDS translations. */
  queryGenes: QueryGene[] | null;
  queries: { queryId: string | null; length: number; hits: number }[];
  loci: ContigLocus[];
  hits: ContigHit[];
  shownGroups: number;
  totalGroups: number;
  totalHits: number;
}

// Bump whenever the response shape changes: completed sessions are cached for an
// hour (max-age=3600) and an old payload would hand the map fields it lacks.
// 6: QueryGene carries geneKind.
const SHAPE_VERSION = 6;

/** Every field the map reads; a payload missing any of them is from an older shape. */
function isUsable(map: unknown): map is ContigMapData {
  if (!map || typeof map !== 'object') return false;
  const m = map as Partial<ContigMapData>;
  return (
    Array.isArray(m.queries) &&
    Array.isArray(m.loci) &&
    Array.isArray(m.hits) &&
    typeof m.totalGroups === 'number' &&
    typeof m.shownGroups === 'number' &&
    typeof m.totalHits === 'number' &&
    (m.queryGenes === null || Array.isArray(m.queryGenes))
  );
}

export function useContigMap(sessionId: string, enabled: boolean, groups?: number) {
  const result = useQuery<ContigMapData, Error>({
    // `groups` is in the key: a different stack depth is a different result set.
    queryKey: ['sequence-search', 'contig-map', sessionId, SHAPE_VERSION, groups ?? null],
    queryFn: async () => {
      const response = await apiGet<{ success: boolean; map?: ContigMapData; error?: string }>(
        `/api/search/sequence/${sessionId}/contig-map?v=${SHAPE_VERSION}` +
          (groups ? `&groups=${groups}` : '')
      );
      if (!response.success || !response.map) {
        throw new Error(response.error ?? 'Failed to build the contig map');
      }
      if (!isUsable(response.map)) {
        throw new Error('Contig map response is from an older format');
      }
      return response.map;
    },
    enabled: enabled && Boolean(sessionId),
    staleTime: 5 * 60 * 1000,
  });

  return {
    data: result.data ?? null,
    isLoading: result.isLoading,
    error: (result.error as Error | null) ?? null,
  };
}
