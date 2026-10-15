import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@/lib/api-client';

type CountsResponse = {
  success: boolean;
  data: { counts: Record<string, number> } | null;
};

/**
 * This study's BGC count per family, for the visible page (<= 200 ids). A property
 * of the (study, GCF) pair, so it cannot live on gcf_browse and the table cannot sort on it.
 */
export function useStudyBgcCounts(studyKey: string | null | undefined, gcfIds: string[]) {
  const key = gcfIds.slice().sort().join(',');
  const query = useQuery<CountsResponse, Error>({
    queryKey: ['study-gcf-counts', studyKey, key],
    queryFn: ({ signal }) =>
      apiGet<CountsResponse>(
        `/api/studies/gcf-counts?study=${encodeURIComponent(studyKey ?? '')}&gcfs=${encodeURIComponent(key)}`,
        { signal }
      ),
    enabled: Boolean(studyKey) && gcfIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });
  return { counts: query.data?.data?.counts ?? {} };
}
