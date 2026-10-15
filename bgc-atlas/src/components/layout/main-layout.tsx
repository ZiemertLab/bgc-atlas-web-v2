import Link from 'next/link';
import { MessageSquare } from 'lucide-react';
import { Navigation } from './navigation';
import { EmailLink } from './email-link';
import { FeedbackDialog } from '@/components/layout/feedback-dialog';
import { Button } from '@/components/ui/button';
import { CitationBadge } from '@/components/ui/citation';
import { CookieBanner } from './cookie-banner';
import { SiteNotice } from './site-notice';
import { DataReleaseLink } from './data-release-link';
import { formatUpdateDate, getLatestUpdate } from '@/lib/updates';

interface MainLayoutProps {
  children: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const latestUpdate = getLatestUpdate();

  return (
    <div className="relative flex min-h-screen flex-col bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        Skip to main content
      </a>
      <SiteNotice />
      <Navigation />
      <main id="main-content" className="flex-1 pb-24 md:pb-12" tabIndex={-1}>
        <div className="mx-auto w-full max-w-[2100px] px-4 lg:px-8 xl:px-12 2xl:px-16">
          {children}
        </div>
      </main>
      <footer className="mt-12 border-t border-border py-8">
        <div className="mx-auto w-full max-w-[2100px] px-4 lg:px-8 xl:px-12 2xl:px-16">
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 md:grid-cols-4">
            <div>
              <div className="section-label mb-2">BGC Atlas</div>
              <p className="text-sm leading-relaxed text-muted-foreground">
                A resource for exploring biosynthetic gene clusters from
                environmental samples across diverse ecosystems.
              </p>
            </div>
            <div>
              <div className="section-label mb-2">Contact</div>
              <div className="space-y-1 text-sm text-foreground">
                <div>Caner Bağcı</div>
                <div className="text-muted-foreground">
                  <a
                    href="https://uni-tuebingen.de/en/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline-offset-4 hover:underline hover:text-foreground"
                  >
                    University of Tübingen
                  </a>
                </div>
                <div className="text-muted-foreground">
                  <a
                    href="https://uni-tuebingen.de/fakultaeten/mathematisch-naturwissenschaftliche-fakultaet/fachbereiche/interfakultaere-einrichtungen/imit/arbeitsgruppen/translational-genome-mining-for-natural-products/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline-offset-4 hover:underline hover:text-foreground"
                  >
                    Translational Genome Mining for Natural Products
                  </a>
                </div>
                <div className="pt-1">
                  <EmailLink />
                </div>
                <div className="pt-3">
                  <FeedbackDialog>
                    <Button variant="outline">
                      <MessageSquare aria-hidden />
                      Send feedback
                    </Button>
                  </FeedbackDialog>
                </div>
              </div>
            </div>
            <CitationBadge className="self-start" />
            <div>
              <div className="section-label mb-2">Updates</div>
              {latestUpdate && (
                <div className="text-sm">
                  <time
                    dateTime={latestUpdate.date}
                    className="font-mono text-xs uppercase tracking-wider text-muted-foreground tabular-nums"
                  >
                    {formatUpdateDate(latestUpdate.date)}
                  </time>
                  <div className="mt-0.5 text-foreground">
                    {latestUpdate.title}
                  </div>
                </div>
              )}
              <Link
                href="/changelog"
                className="mt-2 inline-flex items-center gap-1 text-sm text-foreground underline-offset-4 decoration-foreground/30 hover:underline"
              >
                See full change log →
              </Link>
            </div>
          </div>
          <div className="mt-8 border-t border-border pt-6 text-center text-xs text-muted-foreground">
            <p>
              <a
                href="https://uni-tuebingen.de/en/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline-offset-4 hover:underline hover:text-foreground"
              >
                University of Tübingen
              </a>{' '}
              ·{' '}
              <Link
                href="/imprint"
                className="underline-offset-4 hover:underline hover:text-foreground"
              >
                Imprint
              </Link>{' '}
              ·{' '}
              <Link
                href="/privacy"
                className="underline-offset-4 hover:underline hover:text-foreground"
              >
                Privacy Policy
              </Link>{' '}
              ·{' '}
              {/* v1 is a separate app served by nginx at /v1/: a plain anchor, no withBase(). */}
              <a
                href="/v1/"
                className="underline-offset-4 hover:underline hover:text-foreground"
              >
                Previous version (v1)
              </a>
              <DataReleaseLink />
            </p>
          </div>
        </div>
      </footer>
      <CookieBanner />
    </div>
  );
}
