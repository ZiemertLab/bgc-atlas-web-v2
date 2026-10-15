"use client";

import Link from 'next/link';
import { MainLayout } from '@/components/layout/main-layout';
import { Download, Upload } from 'lucide-react';
import { EmailLink } from '@/components/layout/email-link';
import { FeedbackDialog } from '@/components/layout/feedback-dialog';
import { CitationCards } from '@/components/ui/citation';
import { useStatistics } from '@/lib/hooks/use-statistics';
import { useDataSourceStats, type DataSourceStat } from '@/lib/hooks/use-data-source-stats';

export default function AboutPage() {
  const { data: statisticsData, isLoading: statsLoading } = useStatistics();
  const statistics = statisticsData?.data ?? null;
  const { sources, isLoading: sourcesLoading } = useDataSourceStats();

  const stat = (value?: number | null): string =>
    statsLoading ? '—' : (value ?? 0).toLocaleString();

  // Grouped by the assemblies a source contributed: read-assembled is metagenome,
  // anything else (MAG, isolate, SAG, incl. GTDB) is a genome catalog.
  const metagenomeSources = sources.filter((s) => s.primarySourceType === 'metagenome');
  const genomeSources = sources.filter((s) => s.primarySourceType !== 'metagenome');


  return (
    <MainLayout>
      <div className="mx-auto w-full max-w-[1100px] py-6">
        <header className="mb-8 border-b border-border pb-4">
          <h1 className="atlas-rule mb-3 text-2xl font-semibold tracking-tight md:text-3xl">
            About BGC Atlas
          </h1>
          <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-muted-foreground">
            BGC Atlas is a searchable catalogue of biosynthetic gene clusters
            (BGCs) from publicly available metagenomes and genomes. It holds{' '}
            <span className="font-medium text-foreground">
              {stat(statistics?.totalBgcs)}
            </span>{' '}
            BGCs, grouped into gene cluster families and annotated with the
            taxonomy and the environment each one came from.
          </p>
          <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-muted-foreground">
            Browse by{' '}
            <IntA href="/bgcs">cluster</IntA>, <IntA href="/gcfs">family</IntA>,{' '}
            <IntA href="/samples">sample</IntA> or <IntA href="/studies">study</IntA>;
            search by <IntA href="/search">antiSMASH property or protein sequence</IntA>;
            or take the whole database from <IntA href="/downloads">downloads</IntA>.
          </p>
        </header>

        <section className="mb-10">
          <CitationCards />
        </section>

        <section className="mb-10">
          <div className="section-label mb-1.5">What&apos;s in the Atlas</div>
          <p className="mb-4 max-w-3xl text-[14px] leading-relaxed text-muted-foreground">
            Every assembly comes from a public repository or a published dataset.
            Counts below are a breakdown by source; the assembly and BGC totals are on
            the{' '}
            <IntA href="/">home page</IntA>.
          </p>

          <SourceTable
            heading="Metagenome assemblies"
            caption="Communities assembled directly from environmental reads."
            sources={metagenomeSources}
            isLoading={sourcesLoading}
          />
          <SourceTable
            heading="Genome catalogs"
            caption="Metagenome-assembled, single-cell and isolate genomes."
            sources={genomeSources}
            isLoading={sourcesLoading}
            className="mt-7"
          />

        </section>

        <section className="mb-10">
          <div className="section-label mb-3">Methods</div>
          <div className="max-w-3xl space-y-4 text-[14px] leading-relaxed text-muted-foreground">
            <div>
              <h3 className="mb-1 text-sm font-medium text-foreground">Detection</h3>
              <p>
                BGCs were identified with{' '}
                <ExtA href="https://doi.org/10.64898/2026.07.22.739405">
                  metaSMASH
                </ExtA>{' '}
                1.0.3, a re-engineered fork of{' '}
                <ExtA href="https://antismash.secondarymetabolites.org/">
                  antiSMASH
                </ExtA>{' '}
                built for metagenome-scale assemblies. It preserves antiSMASH&apos;s
                detection and annotation logic, so each region carries the same
                products, product categories and domain content. Genes were
                predicted with Prodigal in metagenomic mode for metagenome
                assemblies and in single-genome mode for isolate genomes and
                metagenome-assembled genomes. A BGC is counted
                as <em>complete</em> when it does not run off the end of its contig:{' '}
                <span className="font-medium text-foreground">
                  {stat(statistics?.totalCompleteBgcs)}
                </span>{' '}
                of {stat(statistics?.totalBgcs)} qualify. The rest are truncated by
                fragmentary assembly rather than by anything biological, so
                completeness says nothing about whether a cluster is functional.
              </p>
            </div>
            <div>
              <h3 className="mb-1 text-sm font-medium text-foreground">Clustering</h3>
              <div className="space-y-2">
                <p>
                  BGCs are grouped into gene cluster families with{' '}
                  <ExtA href="https://doi.org/10.1093/gigascience/giaa154">
                    BiG-SLiCE
                  </ExtA>{' '}
                  2.0.2 at a single distance threshold of 0.4. Clustering runs in
                  two passes: a <em>seed</em> pass over BGCs that are complete or
                  at least median length, then a second pass over what the seed
                  could not place, which produces the <em>fragmented</em> families
                  (the F in{' '}
                  <span className="font-mono text-[13px] text-foreground">
                    GCF-F-…
                  </span>
                  ). 373,360 seed and 256,512 fragmented families are{' '}
                  <IntA href="/gcfs">listed</IntA>.
                </p>
                <p>
                  89.4% of BGCs fall into a family. The rest are mostly regions
                  truncated at a contig edge — short fragments with too little to
                  match on, rather than novel chemistry.
                </p>
                <p>
                  A BGC can sit in more than one family: 2,366,096 do. Each one has
                  a primary family, and the others are listed beside it.
                </p>
                <p>
                  1,335 listed families contain a{' '}
                  <ExtA href="https://mibig.secondarymetabolites.org/">MIBiG</ExtA>{' '}
                  reference cluster and carry the name of the compound it makes.
                </p>
              </div>
            </div>
            <div>
              <h3 className="mb-1 text-sm font-medium text-foreground">Taxonomy</h3>
              <p>
                Taxonomy is assigned per BGC rather than inherited from its sample,
                with{' '}
                <ExtA href="https://github.com/soedinglab/MMseqs2">MMseqs2</ExtA>{' '}
                against <ExtA href="https://gtdb.ecogenomic.org/">GTDB</ExtA>{' '}
                release 232, and covers 99.4% of all BGCs.
              </p>
            </div>
            <div>
              <h3 className="mb-1 text-sm font-medium text-foreground">
                Environmental context
              </h3>
              <p>
                Samples carry{' '}
                <ExtA href="https://gold.jgi.doe.gov/">GOLD</ExtA> ecosystem paths
                and ENVO biome, feature and material terms, covering roughly 94% of
                samples, plus sampling coordinates where the source reports them.
                Environmental metadata for SPIRE samples comes from{' '}
                <ExtA href="https://metalog.embl.de/">metalog</ExtA>.
              </p>
            </div>
          </div>
        </section>

        <section className="mb-10">
          <div className="section-label mb-3">Reuse and licence</div>
          <div className="max-w-3xl space-y-3 text-[14px] leading-relaxed text-muted-foreground">
            <p>
              The data BGC Atlas produces — cluster annotations, family
              assignments, taxonomy and the harmonised environmental metadata — is
              released under{' '}
              <ExtA href="https://creativecommons.org/licenses/by/4.0/">
                CC BY 4.0
              </ExtA>
              . Use it for anything, including commercially, provided you cite the
              resource.
            </p>
            <p>
              The underlying assemblies and genomes are not ours to relicense. They
              remain subject to the terms of the repository or publication they came
              from — see the sources listed above, each of which links to its own
              database or paper.
            </p>
            <p>
              Bulk files are on the{' '}
              <IntA href="/downloads">downloads page</IntA>. If you have BGC data
              you would like included, see{' '}
              <IntA href="/contribute">contribute</IntA>.
            </p>
          </div>
        </section>

        <section className="grid gap-x-8 gap-y-6 border-t border-border pt-6 sm:grid-cols-2">
          <div>
            <div className="section-label mb-2">People and funding</div>
            <p className="text-[14px] leading-relaxed text-muted-foreground">
              BGC Atlas is built and maintained by Caner Bağcı in the{' '}
              <ExtA href="https://uni-tuebingen.de/fakultaeten/mathematisch-naturwissenschaftliche-fakultaet/fachbereiche/interfakultaere-einrichtungen/imit/arbeitsgruppen/translational-genome-mining-for-natural-products/">
                Translational Genome Mining for Natural Products
              </ExtA>{' '}
              group at the{' '}
              <ExtA href="https://uni-tuebingen.de/en/">University of Tübingen</ExtA>
              . The full list of contributors is in the citations above.
            </p>
            <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">
              Funded by the{' '}
              <ExtA href="https://www.dzif.de/en">
                German Center for Infection Research (DZIF)
              </ExtA>{' '}
              and the{' '}
              <ExtA href="https://www.volkswagenstiftung.de/en">
                Volkswagen Foundation
              </ExtA>
              .
            </p>
          </div>
          <div>
            <div className="section-label mb-2">Contact</div>
            <ul className="space-y-1.5 text-sm">
              {/* EmailLink renders its own Mail icon. */}
              <li>
                <EmailLink className="text-foreground underline-offset-4 hover:underline [&>svg]:text-muted-foreground" />
              </li>
              <li>
                <FeedbackDialog className="[&>svg]:text-muted-foreground" />
              </li>
              <li className="flex items-center gap-2">
                <Download className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <Link
                  href="/downloads"
                  className="text-foreground underline-offset-4 hover:underline"
                >
                  Bulk downloads
                </Link>
              </li>
              <li className="flex items-center gap-2">
                <Upload className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <Link
                  href="/contribute"
                  className="text-foreground underline-offset-4 hover:underline"
                >
                  Contribute data
                </Link>
              </li>
            </ul>
          </div>
        </section>
      </div>
    </MainLayout>
  );
}

function SourceTable({
  heading,
  caption,
  sources,
  isLoading,
  className,
}: {
  heading: string;
  caption: string;
  sources: DataSourceStat[];
  isLoading: boolean;
  className?: string;
}) {
  const totalAssemblies = sources.reduce((sum, s) => sum + s.assemblyCount, 0);
  const totalBgcs = sources.reduce((sum, s) => sum + s.bgcCount, 0);

  return (
    <div className={className}>
      <h3 className="text-sm font-medium text-foreground">{heading}</h3>
      <p className="mb-2 text-[13px] text-muted-foreground">{caption}</p>
      <div className="max-w-3xl overflow-x-auto">
        {/* 20rem fits a 390px phone viewport. */}
        <table className="w-full min-w-[20rem] border-collapse text-sm">
          <thead>
            <tr className="border-y border-border text-left">
              <th className="py-1.5 pr-4 font-medium text-muted-foreground">Source</th>
              <th className="py-1.5 pr-4 text-right font-medium text-muted-foreground">
                Assemblies
              </th>
              <th className="py-1.5 text-right font-medium text-muted-foreground">
                BGCs
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={3} className="py-3 text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}
            {!isLoading &&
              sources.map((source) => (
                <tr key={source.id} className="border-b border-border/60">
                  <td className="py-1.5 pr-4">
                    {source.url ? (
                      <ExtA href={source.url}>{source.name}</ExtA>
                    ) : (
                      <span className="text-foreground">{source.name}</span>
                    )}
                  </td>
                  <td className="py-1.5 pr-4 text-right font-mono tabular-nums text-foreground">
                    {source.assemblyCount.toLocaleString()}
                  </td>
                  <td className="py-1.5 text-right font-mono tabular-nums text-foreground">
                    {source.bgcCount.toLocaleString()}
                  </td>
                </tr>
              ))}
            {!isLoading && sources.length > 0 && (
              <tr className="border-b border-border">
                <td className="py-1.5 pr-4 font-medium text-foreground">Total</td>
                <td className="py-1.5 pr-4 text-right font-mono font-medium tabular-nums text-foreground">
                  {totalAssemblies.toLocaleString()}
                </td>
                <td className="py-1.5 text-right font-mono font-medium tabular-nums text-foreground">
                  {totalBgcs.toLocaleString()}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function IntA({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="text-foreground underline underline-offset-4 decoration-foreground/40 hover:decoration-foreground"
    >
      {children}
    </Link>
  );
}

function ExtA({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-foreground underline underline-offset-4 decoration-foreground/40 hover:decoration-foreground"
    >
      {children}
    </a>
  );
}
