'use client';

import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@/lib/api-client';
import type { ReleasesPayload } from './types';

/** The data releases (/api/releases). One query for the Downloads page and the footer. */
export function useReleases() {
  return useQuery({
    queryKey: ['releases'],
    queryFn: () => apiGet<ReleasesPayload>('/api/releases'),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** R2.0-beta.3 -> R2.0: the release a pre-release leads to. */
export const finalOf = (id: string) => id.replace(/-(alpha|beta)\.\d+$/, '');
