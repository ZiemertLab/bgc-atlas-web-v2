import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { apiGet } from '@/lib/api-client';

export interface SequenceSearchGroup {
  groupKey: string;
  queryIds: string[];
  bgcId: string | null;
  /** false when the hit region has no row in `bgcs`; the row then shows "not in Atlas". */
  linked: boolean;
  bgcFilename: string | null;
  contig: string | null;
  products: string[];
  categories: string[];
  sampleId: string | null;
  sampleName: string | null;
  dataSource: string | null;
  gcfId: string | null;
  gcfName: string | null;
  taxonName: string | null;
  taxonLineage: string | null;
  cdsHits: number;
  bestIdentity: number;
  bestCoverage: number;
  bestEValue: number;
  bestBitScore: number;
}

export interface SequenceSearchHit {
  resultId: string;
  bgcId: string | null;
  targetId: string;
  cdsLabel: string;
  queryId: string | null;
  identity: number;
  coverage: number;
  eValue: number;
  bitScore: number;
  queryStart: number;
  queryEnd: number;
  queryLength: number;
  targetStart: number;
  targetEnd: number;
  targetLength: number;
  alignmentLength: number;
  mismatches: number;
  gaps: number;
  rank: number;
  /** Gapped aligned segments; null for searches run before these were captured. */
  queryAligned: string | null;
  targetAligned: string | null;
}

export interface SequenceSearchSession {
  sessionId: string;
  status: string;
  totalHits: number;
  searchDurationMs: number | null;
  createdAt: string;
  completedAt: string | null;
  sequenceType: string;
  hasContigMap?: boolean;
  totalGroups?: number;
  maxResults: number;
  /** Query ids whose hits were cut off at max-target-seqs; empty when nothing was truncated. */
  truncatedQueries: string[];
  parameters: {
    eValue: number;
    minIdentity: number;
    minCoverage: number;
  };
}

export interface UseSequenceSearchOptions {
  minIdentity?: number;
  minCoverage?: number;
  /** Restrict to hits overlapping this span of the query contig. */
  queryFrom?: number;
  queryTo?: number;
  limit?: number;
  offset?: number;
  sortBy?: 'evalue' | 'identity' | 'bitscore' | 'querygenes';
  sortOrder?: 'asc' | 'desc';
}

export interface UseSequenceSearchResult {
  data: SequenceSearchGroup[] | null;
  session: SequenceSearchSession | null;
  isLoading: boolean;
  error: Error | null;
  totalGroups: number;
  offset: number;
  refetch: () => void;
}

interface ApiResultsResponse {
  success: boolean;
  groups?: SequenceSearchGroup[];
  session?: SequenceSearchSession;
  pagination?: {
    total: number;
    hasMore: boolean;
  };
  error?: string;
}

export function useSequenceSearch(
  sessionId: string | null,
  options: UseSequenceSearchOptions = {}
): UseSequenceSearchResult {
  const {
    minIdentity,
    minCoverage,
    queryFrom,
    queryTo,
    limit = 25,
    sortBy = 'evalue',
    sortOrder = 'asc',
  } = options;

  // Offset comes from the caller's page; the hook holds no page state.
  const { offset = 0 } = options;

  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
    sortBy,
    sortOrder,
  });
  if (minIdentity !== undefined) params.append('minIdentity', String(minIdentity));
  if (minCoverage !== undefined) params.append('minCoverage', String(minCoverage));
  if (queryFrom !== undefined) params.append('queryFrom', String(queryFrom));
  if (queryTo !== undefined) params.append('queryTo', String(queryTo));

  const url = sessionId ? `/api/search/sequence/${sessionId}?${params.toString()}` : null;

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ['search', 'sequence-results', sessionId, offset, options],
    queryFn: async ({ signal }) => {
      const response = await apiGet<ApiResultsResponse>(url as string, { signal });
      if (!response.success) {
        throw new Error(response.error || 'Failed to fetch results');
      }
      return response;
    },
    enabled: Boolean(sessionId),
    // Keeps the previous page on screen while the next one loads.
    placeholderData: keepPreviousData,
    staleTime: 30 * 1000,
  });

  return {
    data: data?.groups ?? null,
    session: data?.session ?? null,
    isLoading,
    error: (error as Error | null) ?? null,
    totalGroups: data?.pagination?.total ?? 0,
    offset,
    refetch,
  };
}

/** Only runs once the row is expanded. */
export function useSequenceGroupHits(
  sessionId: string | null,
  // Keyed by BGC only: a group is one BGC, whichever query sequence produced the alignments.
  group: { groupKey: string } | null,
  enabled: boolean,
  filters: { minIdentity?: number; minCoverage?: number } = {},
) {
  const params = new URLSearchParams();
  if (group) {
    params.set('groupKey', group.groupKey);
  }
  if (filters.minIdentity !== undefined) params.set('minIdentity', String(filters.minIdentity));
  if (filters.minCoverage !== undefined) params.set('minCoverage', String(filters.minCoverage));

  const { data, error, isLoading } = useQuery({
    queryKey: ['search', 'sequence-group', sessionId, group?.groupKey, filters],
    queryFn: async ({ signal }) => {
      const response = await apiGet<{ success: boolean; hits?: SequenceSearchHit[]; error?: string }>(
        `/api/search/sequence/${sessionId}/group?${params.toString()}`,
        { signal },
      );
      if (!response.success) {
        throw new Error(response.error || 'Failed to fetch alignments');
      }
      return response.hits ?? [];
    },
    enabled: Boolean(sessionId) && Boolean(group) && enabled,
    staleTime: 5 * 60 * 1000,
  });

  return { hits: data ?? null, isLoading, error: (error as Error | null) ?? null };
}

export interface JobStatus {
  sessionId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  errorMessage?: string;
  totalHits?: number;
  searchDurationMs?: number;
  createdAt: string;
  completedAt?: string;
}

export interface UseJobStatusResult {
  status: JobStatus | null;
  isPolling: boolean;
  error: Error | null;
}
