'use client';

import { ExternalLink } from 'lucide-react';

import {
  abstractLicenseLabel,
  canShowAbstract,
  isPublisherAbstract,
} from '@/lib/abstract-license';
import { doiUrl } from '@/lib/utils/accession';

// Credit line under a study abstract, or the stand-in for one we may not reproduce. Shared by /studies and
// /studies/[id] so neither republishes text the other withholds. Per canShowAbstract(): archive text
// (ENA/MGnify) is credited to the archive; CC-licensed publisher text names the licence and links the DOI;
// anything else shows only the citation and DOI link.

export type AbstractCreditProps = {
  source: string | null;
  doi: string | null;
  license: string | null;
  publisher: string | null;
  /** Primary archive accession, for crediting an ENA/MGnify description. */
  accession?: string | null;
};

export function AbstractCredit({ source, doi, license, publisher, accession }: AbstractCreditProps) {
  const licenseLabel = abstractLicenseLabel(license);

  if (isPublisherAbstract(source)) {
    return (
      <p className="mt-3 text-xs text-muted-foreground">
        Abstract{publisher ? ` © ${publisher}` : ''}
        {licenseLabel ? `, licensed ${licenseLabel}` : ''}
        {doi && (
          <>
            {' · '}
            <a
              href={doiUrl(doi)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-brand hover:underline"
            >
              doi:{doi}
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          </>
        )}
      </p>
    );
  }

  // ENA/MGnify descriptions are written by the submitter, so credit the archive, not a rights holder.
  const archive = source === 'mgnify' ? 'MGnify' : 'ENA';
  return (
    <p className="mt-3 text-xs text-muted-foreground">
      Study description from {archive}
      {accession && (
        <>
          {' · '}
          <a
            href={
              source === 'mgnify'
                ? `https://www.ebi.ac.uk/metagenomics/studies/${encodeURIComponent(accession)}`
                : `https://www.ebi.ac.uk/ena/browser/view/${encodeURIComponent(accession)}`
            }
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-brand hover:underline"
          >
            {accession}
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        </>
      )}
    </p>
  );
}

export function AbstractUnavailable({ doi, publisher }: { doi: string | null; publisher: string | null }) {
  return (
    <p className="text-sm leading-relaxed text-muted-foreground">
      The abstract for this study is {publisher ? `© ${publisher}` : 'under publisher copyright'} and
      is not licensed for redistribution, so it is not reproduced here.{' '}
      {doi ? (
        <a
          href={doiUrl(doi)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-brand hover:underline"
        >
          Read it at the publisher
          <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      ) : (
        'It is available from the original publication.'
      )}
    </p>
  );
}

/** Text we may render, or a withheld abstract worth linking out to; with neither, no panel renders. */
export function hasAbstractContent(study: {
  abstract: string | null;
  abstract_source: string | null;
  abstract_license: string | null;
  abstract_withheld: boolean;
}) {
  const showable =
    !!study.abstract &&
    study.abstract.trim().length >= 20 &&
    canShowAbstract(study.abstract_source, study.abstract_license);
  return showable || study.abstract_withheld;
}

/** Whether the abstract TEXT may be rendered (as opposed to the link-out). */
export function showsAbstractText(study: {
  abstract: string | null;
  abstract_source: string | null;
  abstract_license: string | null;
}) {
  return (
    !!study.abstract &&
    study.abstract.trim().length >= 20 &&
    canShowAbstract(study.abstract_source, study.abstract_license)
  );
}
