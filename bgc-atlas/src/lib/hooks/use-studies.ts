import { useQuery, keepPreviousData } from '@tanstack/react-query';
import type { AbstractState } from '@/lib/abstract-license';

import { apiGet } from '@/lib/api-client';
import type { PaginatedResponse, Study } from '@/lib/types';

type HookResult<T> = {
  data: T;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  hasLoaded: boolean;
};

export type UseStudiesParams = {
  /** Exact study_key: resolves one study, bypassing the listing's exclusions. */
  key?: string;
  limit?: number;
  offset?: number;
  search?: string;
  sortField?: string;
  sortOrder?: string;
  goldBucket?: string;
  biome?: string;
  minBgcs?: number;
  minExclusive?: number;
  advancedFilters?: string;
  enabled?: boolean;
};

const buildQueryString = (params: Record<string, unknown>) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (typeof value === 'number' && !Number.isFinite(value)) return;
    search.set(key, String(value));
  });
  const query = search.toString();
  return query ? `?${query}` : '';
};

const emptyResponse = (params: { limit?: number; offset?: number }): PaginatedResponse<Study> => ({
  success: true,
  data: { data: [], total: 0, limit: params.limit ?? 0, offset: params.offset ?? 0 },
});

/** The streamed "All matching" export. */
export const studyExportPath = (params: UseStudiesParams): string => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { enabled, limit, offset, ...query } = params;
  return `/api/studies/export${buildQueryString(query as Record<string, unknown>)}`;
};

export function useStudies(params: UseStudiesParams = {}): HookResult<PaginatedResponse<Study>> {
  const { enabled = true, ...query } = params;
  const url = `/api/studies${buildQueryString(query as Record<string, unknown>)}`;
  const fallback = emptyResponse(query);

  const result = useQuery<PaginatedResponse<Study>, Error>({
    queryKey: ['studies', 'list', query],
    queryFn: ({ signal }) => apiGet<PaginatedResponse<Study>>(url, { signal }),
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
    enabled,
  });

  return {
    data: result.data ?? fallback,
    isLoading: result.isLoading,
    isFetching: result.isFetching,
    error: (result.error as Error | null) ?? null,
    hasLoaded: result.isFetched,
  };
}

// `abstract` is null when the study has none or its text was withheld for licensing;
// see src/lib/abstract-license.ts.
export type AbstractProvenance = {
  abstract_state: AbstractState;
  abstract_source: string | null;
  abstract_doi: string | null;
  abstract_url: string | null;
  abstract_license: string | null;
  abstract_publisher: string | null;
  abstract_withheld: boolean;
  dois: string[];
  pmids: string[];
};

export type StudyDetail = {
  study: AbstractProvenance & {
    study_key: string;
    study_id: string;
    title: string | null;
    study_name: string | null;
    center_name: string | null;
    study_type: string | null;
    abstract: string | null;
    accessions: string[];
    bioprojects: string[];
    primary_biome: string | null;
    gold_bucket: string | null;
  };
  metrics: {
    total_bgcs: number;
    clustered_bgcs: number;
    gcf_coverage: number | null;
    distinct_gcfs: number;
    exclusive_gcfs: number;
    rare_gcfs: number;
    pct_complete: number | null;
    product_type_count: number;
    sample_count: number;
    product_category_dist: Record<string, number> | null;
  };
  top_exclusive_gcfs: {
    gcf_id: string;
    bgcs_in_study: number;
    name: string | null;
    pet_name?: string | null;
    dom_category?: string | null;
  }[];
  geography: {
    total: number;
    unit_count: number;
    geo_tagged: number;
    bounds: { north: number | null; south: number | null; east: number | null; west: number | null } | null;
    points: {
      id: string;
      external_id: string | null;
      name: string | null;
      latitude: number;
      longitude: number;
      primary_biome: string | null;
      gold_ecosystem_path: string | null;
      bgc_count: number | null;
    }[];
  };
  environment_distribution: { biome: string | null; count: number }[];
};

export type StudyDetailResponse = { success: boolean; data: StudyDetail | null; error?: string; message?: string };

// Row-expander brief (/api/studies/[id]?brief=1): only what the list payload cannot carry.

export type StudyBrief = {
  study: AbstractProvenance & {
    study_key: string;
    abstract: string | null;
    accessions: string[];
    bioprojects: string[];
  };
  top_exclusive_gcfs: {
    gcf_id: string;
    bgcs_in_study: number;
    name: string | null;
    pet_name?: string | null;
    dom_category?: string | null;
  }[];
};

export type StudyBriefResponse = { success: boolean; data: StudyBrief | null; error?: string; message?: string };

export function useStudyBrief(id: string | null | undefined): HookResult<StudyBriefResponse> {
  const result = useQuery<StudyBriefResponse, Error>({
    queryKey: ['studies', 'brief', id],
    queryFn: ({ signal }) => apiGet<StudyBriefResponse>(`/api/studies/${id}?brief=1`, { signal }),
    enabled: Boolean(id),
    staleTime: 5 * 60 * 1000,
  });

  return {
    data: result.data ?? { success: false, data: null },
    isLoading: result.isLoading,
    isFetching: result.isFetching,
    error: (result.error as Error | null) ?? null,
    hasLoaded: result.isFetched,
  };
}

export function useStudy(id: string | null | undefined): HookResult<StudyDetailResponse> {
  const result = useQuery<StudyDetailResponse, Error>({
    queryKey: ['studies', 'detail', id],
    queryFn: ({ signal }) => apiGet<StudyDetailResponse>(`/api/studies/${id}`, { signal }),
    enabled: Boolean(id),
    staleTime: 5 * 60 * 1000,
  });

  return {
    data: result.data ?? { success: false, data: null },
    isLoading: result.isLoading,
    isFetching: result.isFetching,
    error: (result.error as Error | null) ?? null,
    hasLoaded: result.isFetched,
  };
}
