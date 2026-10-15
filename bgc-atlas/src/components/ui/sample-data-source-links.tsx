'use client';

import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { formatDataSourceName, getDataSourceUrl } from '@/lib/utils/data-source-name';

/**
 * The Data Source table cell, shared by /samples and Property Search so the link rules
 * cannot drift. The /studies table passes `studyAccession` instead of a sample id: an
 * MGnify study (MGYS…) deep-links to its study page; every other source falls back to
 * its homepage, as it does for a sample row with no id.
 */
export function SampleDataSourceLinks({ names, externalId, studyAccession }: {
  names: string[] | string | null | undefined;
  externalId?: string | null;
  studyAccession?: string | null;
}) {
  const rawSources = Array.isArray(names) ? names : typeof names === 'string' ? [names] : [];
  const sourceNames: string[] = rawSources
    .filter((name: unknown): name is string => typeof name === 'string' && name.trim().length > 0)
    .map((name: string) => name.trim());
  const sourcesLabel = sourceNames.join(', ');
  const sampleExternalId = typeof externalId === 'string' ? externalId.trim() : '';
  const normalizedSources = new Set(sourceNames.map((name) => name.toLowerCase()));
  const linkTargets: { label: string; href: string }[] = [];
  const linkedSourceKeys = new Set<string>();

  if (sampleExternalId) {
    const encodedId = encodeURIComponent(sampleExternalId);

    if (normalizedSources.has('mgnify')) {
      linkTargets.push({
        label: 'MGnify',
        href: `https://www.ebi.ac.uk/metagenomics/samples/${encodedId}`
      });
      linkedSourceKeys.add('mgnify');
    }

    if (normalizedSources.has('metalog') || normalizedSources.has('spire')) {
      if (normalizedSources.has('metalog')) {
        linkedSourceKeys.add('metalog');
      }
      if (normalizedSources.has('spire')) {
        linkedSourceKeys.add('spire');
      }
      linkTargets.push(
        {
          label: 'metalog',
          href: `https://metalog.embl.de/search?query=${encodedId}`
        },
        {
          label: 'SPIRE',
          href: `https://spire.embl.de/sample/${encodedId}`
        }
      );
    }
  }

  const mgnifyStudy = typeof studyAccession === 'string' ? studyAccession.trim() : '';
  if (!sampleExternalId && /^MGYS\d+$/.test(mgnifyStudy) && normalizedSources.has('mgnify')) {
    linkTargets.push({
      label: 'MGnify',
      href: `https://www.ebi.ac.uk/metagenomics/studies/${mgnifyStudy}`,
    });
    linkedSourceKeys.add('mgnify');
  }

  const plainSources = sourceNames.filter(name => !linkedSourceKeys.has(name.toLowerCase()));
  const plainSourceLinks = plainSources.map(name => ({
    name,
    label: formatDataSourceName(name),
    href: getDataSourceUrl(name),
  }));

  if (!sourcesLabel && linkTargets.length === 0) {
    return <span className="text-sm text-muted-foreground">-</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {linkTargets.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-foreground underline underline-offset-2 decoration-foreground/50 hover:decoration-foreground"
          title={`View ${sampleExternalId || mgnifyStudy} on ${link.label}`}
        >
          {link.label}
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      ))}
      {plainSourceLinks.map(({ name, label, href }, index) => {
        const suffix = index < plainSourceLinks.length - 1 ? ', ' : '';
        if (href) {
          return (
            <span key={name} className="text-sm">
              <Link
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-foreground underline underline-offset-2 decoration-foreground/50 hover:decoration-foreground"
                title={`View ${label}`}
              >
                {label}
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
              {suffix}
            </span>
          );
        }
        return (
          <span key={name} className="text-sm truncate" title={label}>
            {label}{suffix}
          </span>
        );
      })}
    </div>
  );
}
