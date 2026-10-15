import Link from 'next/link';
import { MainLayout } from '@/components/layout/main-layout';
import { getAllUpdates } from '@/lib/updates';

export default function ChangelogPage() {
  const updates = getAllUpdates();

  return (
    <MainLayout>
      <div className="mx-auto w-full max-w-[1100px] py-6">
        <header className="mb-8 border-b border-border pb-4">
          <div className="section-label mb-1.5">BGC Atlas</div>
          <h1 className="atlas-rule mb-3 text-2xl font-semibold tracking-tight md:text-3xl">
            Change log
          </h1>
          <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-muted-foreground">
            Dataset additions, new analyses, and changes to the web resource, newest
            first. For what BGC Atlas contains and how it was built, see{' '}
            <Link
              href="/about"
              className="text-foreground underline underline-offset-4 decoration-foreground/40 hover:decoration-foreground"
            >
              About
            </Link>
            ; for what changed in each data release on Downloads,{' '}
            <Link
              href="/releases"
              className="text-foreground underline underline-offset-4 decoration-foreground/40 hover:decoration-foreground"
            >
              Data releases
            </Link>
            .
          </p>
        </header>

        <ul className="space-y-3.5 text-sm">
          {updates.map((update, index) => (
            <li
              key={`${update.date}-${index}`}
              className="grid grid-cols-[7rem_1fr] gap-4 border-b border-border pb-3.5 last:border-b-0"
            >
              <div className="flex flex-col gap-1">
                <time
                  dateTime={update.date}
                  className="font-mono text-xs uppercase tracking-wider text-muted-foreground tabular-nums"
                >
                  {update.date}
                </time>
                {update.version && (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {update.version}
                  </span>
                )}
              </div>
              <div>
                <div className="font-medium text-foreground">{update.title}</div>
                <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
                  {update.description}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </MainLayout>
  );
}
