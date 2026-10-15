'use client';

import Link from 'next/link';
import { ArrowUpRight, ExternalLink } from 'lucide-react';

import {
  AbstractCredit,
  AbstractUnavailable,
  hasAbstractContent,
  showsAbstractText,
} from '@/components/ui/abstract-credit';
import { useStudyBrief } from '@/lib/hooks/use-studies';
import { bioprojectUrl, doiUrl, isBioProject, isDoi, pubmedUrl, showStudyKey } from '@/lib/utils/accession';
import { getGOLDColorHex } from '@/lib/utils/gold-parser';
import type { Study } from '@/lib/types';

// Row expander for /studies: metrics come with the list payload; only the abstract and GCF
// names arrive from /api/studies/[id]?brief=1.



export function StudyDetailsPanel({ study }: { study: Study }) {
  const { data, isLoading } = useStudyBrief(study.study_id);
  const brief = data.data;

  // Until the brief lands, fall back to the list row's accession/BioProject. Both sides are
  // deduped: an accession is often its BioProject id.
  const identifiers = [
    ...new Set(
      brief
        ? [...brief.study.accessions, ...brief.study.bioprojects]
        : ([study.accession, study.bioproject].filter(Boolean) as string[])
    ),
  ];

  const abstract = brief?.study.abstract ?? null;

  // Deduped against the accessions: some custom studies use their DOI as the accession.
  const citations = [
    ...(brief?.study.dois ?? [])
      .filter((doi) => !identifiers.some((acc) => acc.toLowerCase() === doi.toLowerCase()))
      .map((doi) => ({ label: `doi:${doi}`, href: doiUrl(doi) })),
    ...(brief?.study.pmids ?? []).map((pmid) => ({ label: `PMID:${pmid}`, href: pubmedUrl(pmid) })),
  ];


  // primary_biome is sparse and only refines gold_bucket.
  const biome = study.gold_bucket;

  // GCF counts in the row are bounded by this coverage, which varies by study; the
  // Exclusive GCFs header tooltip points readers here for it.
  const coverage = study.gcf_coverage == null ? null : Math.round(study.gcf_coverage * 100);

  return (
    <div className="border-t bg-muted/30 px-6 py-5">
      <div className="max-w-[1100px] space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              {/* The title must match StudyRow's fallback chain exactly. */}
              {showStudyKey(study.study_key, {
                identifiers,
                title: study.title || study.study_name || study.study_key,
              }) && (
                <span className="font-mono text-xs text-muted-foreground">{study.study_key}</span>
              )}
              {study.center_name && <span className="text-muted-foreground">{study.center_name}</span>}
              {biome && (
                <span
                  className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground"
                  title={study.primary_biome ?? undefined}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: getGOLDColorHex(study.gold_bucket) }}
                    aria-hidden
                  />
                  <span className="truncate">{biome}</span>
                </span>
              )}
              {coverage != null && (
                <span className="text-muted-foreground">
                  <span className="font-mono tabular-nums">
                    {study.clustered_bgcs.toLocaleString()}
                  </span>{' '}
                  of{' '}
                  <span className="font-mono tabular-nums">
                    {study.total_bgcs.toLocaleString()}
                  </span>{' '}
                  BGCs clustered <span className="tabular-nums">({coverage}%)</span>
                </span>
              )}
            </div>
            {(identifiers.length > 0 || citations.length > 0) && (
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs">
                {identifiers.map((acc) => {
                  const href = isBioProject(acc)
                    ? bioprojectUrl(acc)
                    : isDoi(acc)
                      ? doiUrl(acc)
                      : null;
                  return href ? (
                    <a
                      key={acc}
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-brand hover:underline"
                    >
                      {acc}
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  ) : (
                    <span key={acc} className="text-muted-foreground">
                      {acc}
                    </span>
                  );
                })}
                {citations.map(({ label, href }) => (
                  <a
                    key={href}
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-brand hover:underline"
                  >
                    {label}
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                ))}
              </div>
            )}
          </div>
          <Link
            href={`/studies/${study.study_id}`}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            Full study page
            <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>

        {/* No abstract: the block is dropped. A licence-withheld abstract becomes a publisher link. */}
        {isLoading ? (
          <div className="max-w-4xl space-y-1.5" aria-hidden="true">
            <div className="h-3 w-full animate-pulse rounded bg-muted" />
            <div className="h-3 w-11/12 animate-pulse rounded bg-muted" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
          </div>
        ) : (
          brief &&
          hasAbstractContent(brief.study) && (
            <div className="max-w-[70ch]">
              {showsAbstractText(brief.study) ? (
                <>
                  <p className="text-sm leading-relaxed text-muted-foreground">{abstract}</p>
                  <AbstractCredit
                    source={brief.study.abstract_source}
                    doi={brief.study.abstract_doi}
                    license={brief.study.abstract_license}
                    publisher={brief.study.abstract_publisher}
                    accession={brief.study.accessions[0] ?? null}
                  />
                </>
              ) : (
                <AbstractUnavailable
                  doi={brief.study.abstract_doi ?? brief.study.dois[0] ?? null}
                  publisher={brief.study.abstract_publisher}
                />
              )}
            </div>
          )
        )}



      </div>
    </div>
  );
}
