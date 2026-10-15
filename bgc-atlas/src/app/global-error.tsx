'use client';

import { useEffect, useState } from 'react';

import './globals.css';
import { EmailLink } from '@/components/layout/email-link';

// Replaces the root layout, so it must not assume the rest of the app works: no MainLayout, no
// counts, no webfonts, and globals.css imported directly because the layout never ran.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Unhandled root error', error);
  }, [error]);

  const [context, setContext] = useState<{ url: string; at: string } | null>(null);
  useEffect(() => {
    setContext({ url: window.location.href, at: new Date().toISOString() });
  }, []);

  const reference = error.digest ?? null;
  const body = [
    'BGC Atlas failed to load.',
    '',
    reference ? `Reference: ${reference}` : 'Reference: none (client-side error)',
    `Page: ${context?.url ?? ''}`,
    `Time: ${context?.at ?? ''}`,
  ].join('\n');

  return (
    <html lang="en">
      <body className="antialiased">
        <div className="mx-auto w-full max-w-[600px] px-4 py-24 text-center">
          <div className="font-mono text-7xl font-semibold tracking-tight md:text-8xl">
            Error
          </div>
          <h1 className="mt-3 text-xl font-semibold tracking-tight md:text-2xl">
            BGC Atlas failed to load
          </h1>

          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={reset}
              className="rounded-md bg-brand px-3.5 py-2 text-sm font-medium text-brand-foreground"
            >
              Try again
            </button>
            {/* A real document navigation: the router may be what failed. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              className="rounded-md border border-border px-3.5 py-2 text-sm font-medium underline-offset-4 hover:underline"
            >
              Home
            </a>
          </div>

          <div className="mt-8 text-sm text-muted-foreground">
            <p>If it keeps happening, send this to</p>
            <EmailLink
              className="mt-1 justify-center text-foreground underline-offset-4 hover:underline"
              ariaLabel="Email a report of this error"
              subject={
                reference ? `BGC Atlas failed to load (${reference})` : 'BGC Atlas failed to load'
              }
              body={body}
            />
            {reference && (
              <p className="mt-3 font-mono text-xs break-all text-muted-foreground">
                {reference}
              </p>
            )}
          </div>
        </div>
      </body>
    </html>
  );
}
