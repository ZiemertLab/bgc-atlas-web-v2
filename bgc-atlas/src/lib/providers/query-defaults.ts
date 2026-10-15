import type { DefaultOptions } from '@tanstack/react-query';

import { retryUnlessClientError } from '@/lib/api-client';

// A .ts module (not inside the provider) so it can be unit-tested; vitest only picks up .test.ts.
// A 4xx is not retried: it is an answer about the request, not a transient failure.
export const queryDefaults: DefaultOptions = {
  queries: {
    staleTime: 5 * 60 * 1000,
    retry: retryUnlessClientError,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  },
};
