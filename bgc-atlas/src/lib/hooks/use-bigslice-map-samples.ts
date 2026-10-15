import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@/lib/api-client';
import type { SequenceMapSample } from '@/lib/hooks/use-sequence-map-samples';

interface Response {
  success: boolean;
  data: SequenceMapSample[];
  total: number;
  families: number;
  limit?: number;
  error?: string;
}

const EMPTY: Response = { success: true, data: [], total: 0, families: 0 };

/**
 * Sample geography for the families a BiG-SLiCE search matched. Gated on the
 * panel's disclosure state: it spans every matched family (~2 s for a few dozen).
 */
export function useBigsliceMapSamples(sessionId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['bigslice-map-samples', sessionId],
    enabled: enabled && Boolean(sessionId),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const response = await apiGet<Response>(
        `/api/search/bigslice/${sessionId}/samples/map`,
      );
      return response ?? EMPTY;
    },
  });
}
