import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { EnvFieldSummary } from '@/lib/utils/environment-fields';

export type GcfEnvironmentResponse = {
  success: boolean;
  fields: EnvFieldSummary[];
  /** Every sample the family was found in, measured or not — the caption's denominator. */
  totalSamples: number;
  message?: string;
};

/** `enabled` lets the panel defer the query until it is opened. */
export function useGcfEnvironment(gcfId: string | null | undefined, enabled = true) {
  const { data, error, isLoading } = useQuery({
    queryKey: gcfId ? queryKeys.gcfs.environment(gcfId) : ['gcfs', 'environment', null],
    queryFn: ({ signal }) =>
      apiGet<GcfEnvironmentResponse>(`/api/gcfs/${gcfId}/environment`, { signal }),
    enabled: Boolean(gcfId) && enabled,
    staleTime: 60 * 60 * 1000,
  });

  return {
    fields: data?.fields ?? [],
    totalSamples: data?.totalSamples ?? 0,
    isLoading,
    error: error as Error | null,
  };
}
