'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout/main-layout';
import { useStatistics } from '@/lib/hooks/use-statistics';
import { StatLinkRow } from '@/components/ui/stat-leader-row';
import { SampleMapDots } from '@/components/ui/sample-map-dots';
import { MAP_WORLD_WIDTH } from '@/components/ui/map-layout';
import { getRecentUpdates } from '@/lib/updates';
import { withBase } from '@/lib/basePath';

const SEARCH_MODES = [
  {
    href: '/search?tab=properties',
    question: 'Find BGCs by property',
    gloss: 'antiSMASH properties — product class, taxonomy, region length — across every BGC',
  },
  {
    href: '/search?tab=bgc',
    question: 'Does my BGC cluster with a family in the BGC Atlas?',
    gloss: 'BiG-SLiCE placement against gene cluster families',
  },
  {
    href: '/search?tab=sequence',
    question: 'Search by sequence',
    gloss: 'FASTA or GenBank; blastp / blastx via DIAMOND',
  },
] as const;

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const { data: statisticsData, isLoading: statsLoading } = useStatistics();
  const statistics = statisticsData?.data || null;

  useEffect(() => {
    setMounted(true);
  }, []);

  const updates = getRecentUpdates(5);

  const stat = (value?: number | null): string =>
    !mounted || statsLoading ? '—' : (value ?? 0).toLocaleString();

  return (
    <MainLayout>
      <section className="py-8 pb-12 md:py-10">
        <div className="grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-3">
          <div className="flex flex-col gap-8 lg:col-span-1">
            {/* Logo beside the title, except from lg to 1400px: the column is
                300-420px there, which leaves the paragraph 100-180px wide and
                breaks the title onto two lines. */}
            <div className="flex items-start gap-5 md:gap-6 lg:max-[1400px]:flex-col">
              <Image
                src={withBase("/bgc-atlas-logo.svg")}
                alt=""
                width={200}
                height={200}
                className="hidden sm:block size-50 shrink-0"
                priority
                unoptimized
              />
              <div className="max-w-prose">
                <h1 className="text-3xl md:text-4xl font-semibold tracking-tight leading-tight">
                  BGC Atlas
                  <span className="sr-only">
                    {" "}— an atlas of biosynthetic gene clusters (BGCs) and gene
                    cluster families (GCFs) from environmental metagenomes
                  </span>
                </h1>
                <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
                  An atlas of biosynthetic gene clusters (BGCs) from environmental
                  metagenomic samples. Browse, query, and
                  download BGCs, gene cluster families (GCFs), and inspect their
                  taxonomic and ecological context.
                </p>
              </div>
            </div>

            {/* Hrefs match /404's DestinationsStrip. A <dl> may not contain an anchor, hence the <ul>. */}
            <div>
              <div className="section-label mb-2.5">Dataset overview</div>
              <ul className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm">
                <StatLinkRow href="/samples" label="Metagenome Samples" value={stat(statistics?.totalMetagenomeSamples)} />
                <StatLinkRow href="/samples?view=assemblies" label="Metagenome Assemblies" value={stat(statistics?.totalMetagenomeAssemblies)} />
                <StatLinkRow href="/genome-collections" label="Genomes" value={stat(statistics?.totalGenomes)} />
                <StatLinkRow href="/bgcs" label="Biosynthetic Gene Clusters (BGCs)" value={stat(statistics?.totalBgcs)} />
                <StatLinkRow href="/bgcs?completeness=complete" label="Complete BGCs" value={stat(statistics?.totalCompleteBgcs)} />
                <StatLinkRow href="/gcfs" label="Gene Cluster Families (GCFs)" value={stat(statistics?.totalGcfs)} />
              </ul>
            </div>

            <div className="border-t border-border pt-6">
              <div className="section-label mb-3">Search the atlas</div>
              <ul className="grid gap-3 text-sm">
                {SEARCH_MODES.map((mode) => (
                  <li key={mode.href}>
                    <Link
                      href={mode.href}
                      className="group block rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <span className="inline-flex items-center gap-1 text-[13.5px] leading-snug text-foreground underline-offset-4 decoration-foreground/30 group-hover:underline">
                        {mode.question} <span aria-hidden>&rarr;</span>
                      </span>
                      <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">
                        {mode.gloss}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div className="border-t border-border pt-6">
              <div className="section-label mb-3">Recent updates</div>
              <ul className="grid gap-2 text-sm">
                {updates.map((update) => (
                  <li
                    key={`${update.date}-${update.title}`}
                    className="grid grid-cols-[6rem_1fr] gap-3"
                  >
                    <time className="pt-px font-mono text-xs uppercase tracking-wider text-muted-foreground tabular-nums">
                      {update.date}
                    </time>
                    <span className="text-[13.5px] leading-snug text-foreground">
                      {update.title}
                    </span>
                  </li>
                ))}
              </ul>
              <Link
                href="/changelog"
                className="mt-3 inline-flex items-center gap-1 text-sm text-foreground underline-offset-4 decoration-foreground/30 hover:underline"
              >
                See full change log →
              </Link>
            </div>
          </div>

          {/* The map centres itself at one world width; the label shares its box. */}
          <div className="lg:col-span-2">
            <div className="mx-auto w-full" style={{ maxWidth: MAP_WORLD_WIDTH }}>
              <div className="section-label mb-2.5">Sample Origins: Global Distribution</div>
              {mounted ? (
                <SampleMapDots
                  staticManifestUrl="/data/map-samples.manifest.json"
                  blockClassName="w-full"
                />
              ) : (
                <div className="flex h-[800px] w-full items-center justify-center border border-border bg-card">
                  <p className="text-sm text-muted-foreground">Loading map…</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </MainLayout>
  );
}
