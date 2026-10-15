'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';

import { apiGet } from '@/lib/api-client';

/**
 * Maintenance strip above the navbar. Renders nothing unless the `site:notice`
 * Redis key is set (see /api/site-notice), so it ships dormant and is switched
 * on and off without a deploy. Not dismissable: it says the data is in flux,
 * which stays true until the key is cleared.
 */
export function SiteNotice() {
  const { data } = useQuery({
    queryKey: ['site-notice'],
    queryFn: () => apiGet<{ message: string | null }>('/api/site-notice'),
    staleTime: 60 * 1000,
    retry: false,
  });

  const message = data?.message;
  if (!message) return null;

  return (
    <div role="status" className="border-b border-warning/30 bg-warning/10 text-warning">
      <div className="mx-auto flex w-full max-w-[2100px] items-start gap-2.5 px-4 py-3 text-base font-medium lg:px-8 xl:px-12 2xl:px-16">
        <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
        <p className="min-w-0">{message}</p>
      </div>
    </div>
  );
}
