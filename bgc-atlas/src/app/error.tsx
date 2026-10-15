'use client';

import { useEffect, useState } from 'react';

import { DestinationsStrip } from '@/components/layout/destinations-strip';
import { EmailLink } from '@/components/layout/email-link';
import { MainLayout } from '@/components/layout/main-layout';
import { Button } from '@/components/ui/button';

/**
 * Site-wide error boundary. "Error", not "500": client-side render errors carry no status code.
 * A crash in the root layout goes to global-error.tsx instead.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // The digest is the only handle on the server-side log entry.
  useEffect(() => {
    console.error('Unhandled error', error);
  }, [error]);

  // Read after mount: location and time differ between the prerender and the browser.
  const [context, setContext] = useState<{ url: string; at: string } | null>(null);
  useEffect(() => {
    setContext({ url: window.location.href, at: new Date().toISOString() });
  }, []);

  const reference = error.digest ?? null;
  const subject = reference
    ? `BGC Atlas error report (${reference})`
    : 'BGC Atlas error report';
  const body = [
    'Something went wrong on BGC Atlas.',
    '',
    reference ? `Reference: ${reference}` : 'Reference: none (client-side error)',
    `Page: ${context?.url ?? ''}`,
    `Time: ${context?.at ?? ''}`,
  ].join('\n');

  return (
    <MainLayout>
      <div className="mx-auto w-full max-w-[600px] py-16 text-center md:py-24">
        <div className="font-mono text-7xl font-semibold tracking-tight md:text-8xl">
          Error
        </div>
        <h1 className="mt-3 text-xl font-semibold tracking-tight md:text-2xl">
          Something went wrong
        </h1>

        <div className="mt-6">
          <Button onClick={reset}>Try again</Button>
        </div>

        <div className="mt-8 text-sm text-muted-foreground">
          <p>If it keeps happening, send this to</p>
          <EmailLink
            className="mt-1 justify-center text-foreground underline-offset-4 hover:underline"
            ariaLabel="Email a report of this error"
            subject={subject}
            body={body}
          />
          {reference && (
            <p className="mt-3 font-mono text-xs break-all text-muted-foreground">
              {reference}
            </p>
          )}
        </div>

        <DestinationsStrip />
      </div>
    </MainLayout>
  );
}
