"use client";

import Link from "next/link";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { ArrowUpRight, ExternalLink } from "lucide-react";
import type { BgcDetail } from "./bgc-detail-types";

const fmt = (value: number | null | undefined): string =>
  value === null || value === undefined ? "—" : value.toLocaleString();

export function BgcDetailSummary({ bgc }: { bgc: BgcDetail }) {
  return (
    <>
      <section className="mb-6 border-b border-border pb-4">
        <div className="section-label mb-2.5">Summary</div>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-5">
          <div className="leader-row">
            <dt className="whitespace-nowrap text-muted-foreground">Length</dt>
            <span className="leader-dots" aria-hidden />
            <dd className="font-mono font-medium tabular-nums text-foreground">
              {fmt(bgc.length)} bp
            </dd>
          </div>
          <div className="leader-row">
            <dt className="whitespace-nowrap text-muted-foreground">Genes</dt>
            <span className="leader-dots" aria-hidden />
            <dd className="font-mono font-medium tabular-nums text-foreground">
              {fmt(bgc.genes)}
            </dd>
          </div>
          <div className="leader-row">
            <dt className="whitespace-nowrap text-muted-foreground">Position</dt>
            <span className="leader-dots" aria-hidden />
            {/* The contig sits above the span: offsets alone cannot be looked up, and inline the
                run would be unbreakable and push the strip wide. */}
            <dd className="min-w-0 text-right">
              {bgc.contig && (
                // One ellipsised line: a ~60-character MGnify contig would otherwise wrap into
                // four lines and crush the leader dots. The full name is in the filename line.
                <div
                  className="truncate font-mono text-muted-foreground"
                  title={bgc.contig}
                >
                  {bgc.contig}
                </div>
              )}
              <div className="font-mono tabular-nums text-foreground">
                {fmt(bgc.startPos)}–{fmt(bgc.endPos)}
              </div>
            </dd>
          </div>
          <div className="leader-row">
            <dt className="whitespace-nowrap text-muted-foreground">GCF</dt>
            <span className="leader-dots" aria-hidden />
            <dd className="font-mono tabular-nums text-foreground">
              {bgc.gcf ? (
                <Link
                  href={`/gcfs/${bgc.gcf}`}
                  className="inline-flex items-center gap-0.5 text-brand underline underline-offset-2 hover:text-brand/80"
                  title={bgc.gcfPetName ?? bgc.gcf}
                >
                  {/* The family's name rather than a truncated uuid. */}
                  {bgc.gcfName ?? `${bgc.gcf.slice(0, 10)}…`}
                  <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                </Link>
              ) : (
                // font-sans so the word reads as a state, not an identifier.
                <span className="font-sans text-muted-foreground">Unclustered</span>
              )}
            </dd>
          </div>
          <div className="leader-row">
            <dt className="whitespace-nowrap text-muted-foreground">GCF Distance</dt>
            <span className="leader-dots" aria-hidden />
            <dd className="font-mono font-medium tabular-nums text-foreground">
              {bgc.distance !== null ? bgc.distance.toFixed(3) : "—"}
            </dd>
          </div>
        </dl>

        {/* Not a sixth grid cell: at lg the grid is exactly 5 wide and a 6th would orphan. */}
        {bgc.mibigHomology && <MibigHomologyLine homology={bgc.mibigHomology} />}
      </section>

      {(bgc.alsoInFamilies?.length ?? 0) > 0 && (
        <section className="mb-6">
          <CollapsibleSection
            title="Also in"
            badge={bgc.alsoInFamilies.length.toLocaleString()}
          >
            <p className="mb-3 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
              This region is contained in {bgc.alsoInFamilies.length.toLocaleString()}{" "}
              further {bgc.alsoInFamilies.length === 1 ? "family" : "families"} besides
              the one above. Its shared core matches several sibling families, which
              happens when the region is truncated at a contig edge. The family above
              is the best-supported assignment and the one every count on the site
              uses.
            </p>
            <ul className="space-y-1.5">
              {bgc.alsoInFamilies.map((f) => (
                <li key={f.id} className="flex items-baseline gap-2 text-[13px]">
                  {f.listed ? (
                    <Link
                      href={`/gcfs/${f.id}`}
                      className="font-mono text-brand underline underline-offset-2 hover:text-brand/80"
                    >
                      {f.name ?? f.id}
                    </Link>
                  ) : (
                    <span className="font-mono text-foreground">{f.name ?? f.id}</span>
                  )}
                  {f.petName && (
                    <span className="font-mono text-muted-foreground">{f.petName}</span>
                  )}
                  {f.distance !== null && (
                    <span className="ml-auto font-mono tabular-nums text-muted-foreground">
                      {f.distance.toFixed(3)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </CollapsibleSection>
        </section>
      )}
    </>
  );
}

// MIBiG 4.x only resolves versioned accessions (BGC0001615.3); these are indexed with the version.
const MIBIG_VERSIONED = /^BGC\d{7}\.\d+$/;

function MibigHomologyLine({
  homology,
}: {
  homology: NonNullable<BgcDetail["mibigHomology"]>;
}) {
  // Prefer KnownClusterBLAST: it carries a compound name. ClusterCompare only gives an accession
  // and a score on a different scale.
  const useKcb = homology.knownClusterTop !== null;
  const accession = useKcb ? homology.knownClusterTop : homology.comparisonTop;
  if (!accession) return null;

  const href = MIBIG_VERSIONED.test(accession)
    ? `https://mibig.secondarymetabolites.org/repository/${accession}/`
    : null;

  return (
    <div className="mt-3 border-t border-border/60 pt-3">
      <dl className="leader-row max-w-2xl text-sm">
        <dt className="whitespace-nowrap text-muted-foreground">
          {useKcb ? "Closest known cluster" : "ClusterCompare best hit"}
        </dt>
        <span className="leader-dots" aria-hidden />
        {/* Accession and score are nowrap, so they sit in their own wrapping row to fit 390px. */}
        <dd className="min-w-0 text-right text-foreground">
          {useKcb && homology.knownClusterCompound && (
            // A compound can be 100+ characters with several "/"-separated names.
            <div className="break-words">{homology.knownClusterCompound}</div>
          )}
          <div className="flex flex-wrap items-baseline justify-end gap-x-2">
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 whitespace-nowrap font-mono text-brand underline underline-offset-2 hover:text-brand/80"
                title={`${accession} in the MIBiG repository`}
              >
                {accession}
                <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
              </a>
            ) : (
              <span className="whitespace-nowrap font-mono">{accession}</span>
            )}
            {useKcb && homology.knownClusterSimilarity !== null && (
              <span className="whitespace-nowrap font-mono tabular-nums text-muted-foreground">
                {homology.knownClusterSimilarity}% similar
              </span>
            )}
            {!useKcb && homology.comparisonScore !== null && (
              <span className="whitespace-nowrap font-mono tabular-nums text-muted-foreground">
                score {homology.comparisonScore.toFixed(2)}
              </span>
            )}
          </div>
        </dd>
      </dl>
    </div>
  );
}
