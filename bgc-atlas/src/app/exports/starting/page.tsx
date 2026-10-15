'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { MainLayout } from '@/components/layout/main-layout';

// Export buttons open their tab inside the click (popup blockers) and point it here until the job exists.
// Reached any other way, nothing replaces it, so after a while it says so.
const STUCK_AFTER_MS = 30_000;

export default function ExportStartingPage() {
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setStuck(true), STUCK_AFTER_MS);
    return () => clearTimeout(t);
  }, []);

  return (
    <MainLayout>
      <div className="mx-auto w-full max-w-[1100px] py-8">
        <header className="mb-6 border-b border-border pb-4">
          <div className="section-label mb-1.5">GBK export</div>
          <div className="atlas-rule mb-3 flex items-center gap-3">
            <Loader2 className="size-6 shrink-0 animate-spin text-muted-foreground" aria-hidden />
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Starting your export…</h1>
          </div>
          <p className="text-sm text-muted-foreground" role="status">
            {stuck ? (
              <>
                This is taking longer than it should. If the export page does not open, go back to{' '}
                <Link href="/search?tab=properties" className="underline underline-offset-4">search</Link>
                {' '}and try again; exports you started are listed under Recent Jobs.
              </>
            ) : (
              'The export page opens here in a moment.'
            )}
          </p>
        </header>
      </div>
    </MainLayout>
  );
}
