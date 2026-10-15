/**
 * `abstract_source` separates two legal populations: `ena`/`mgnify` are submitter-written
 * archive descriptions (render, credit the archive); `crossref`/`europepmc` are publisher
 * text, rendered only when `abstract_license` allows. `null` provenance is treated as closed.
 *
 * `isOpenAbstractLicense` is mirrored by `classify_license` in
 * scripts/populator/tools/backfill_abstract_provenance.py; change both together.
 */

export type AbstractSource = 'crossref' | 'europepmc' | 'ena' | 'mgnify';

const PUBLISHER_SOURCES: readonly string[] = ['crossref', 'europepmc'];

const ARCHIVE_SOURCES: readonly string[] = ['ena', 'mgnify'];

/** creativecommons.org/licenses/<code>/ and /publicdomain/<code>/. */
const CC_URL_RE = /creativecommons\.org\/(licenses|publicdomain)\//i;
const CC_PARTS_RE = /creativecommons\.org\/(licenses|publicdomain)\/([a-z-]+)(?:\/([\d.]+))?/i;

// Any Creative Commons licence counts (an unchanged abstract is not a derivative; the atlas is
// non-commercial). Default-deny otherwise: TDM grants permit mining, not redistribution.
export function isOpenAbstractLicense(url: string | null | undefined): boolean {
  return !!url && CC_URL_RE.test(url);
}

export function canShowAbstract(
  source: string | null | undefined,
  license: string | null | undefined
): boolean {
  if (source && ARCHIVE_SOURCES.includes(source)) return true;
  if (source && PUBLISHER_SOURCES.includes(source)) return isOpenAbstractLicense(license);
  return false;
}

export function isPublisherAbstract(source: string | null | undefined): boolean {
  return !!source && PUBLISHER_SOURCES.includes(source);
}

// Null for anything we cannot name, so the caller renders no badge rather than a misleading one.
export function abstractLicenseLabel(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = CC_PARTS_RE.exec(url);
  if (!m) return null;
  const [, kind, code, version] = m;
  const v = version ? ` ${version}` : '';
  if (kind.toLowerCase() === 'publicdomain') {
    if (code.toLowerCase() === 'zero') return `CC0${v}`;
    if (code.toLowerCase() === 'mark') return `Public Domain Mark${v}`;
    return null;
  }
  return `CC ${code.toUpperCase()}${v}`;
}

/**
 * `available`: text served here, with attribution fields. `withheld`: a publication abstract
 * exists but may not be redistributed; `abstract_doi`/`abstract_url` point at the publisher.
 * `absent`: none collected (not that the study has none). `abstract: null` alone conflates the last two.
 */
export const ABSTRACT_STATES = ['available', 'withheld', 'absent'] as const;

export type AbstractState = (typeof ABSTRACT_STATES)[number];

// `hasAbstract` wins over `withheld`, matching collapseSiblings() in /api/studies/[id]: the
// payload ships one sibling's text beside another's withheld flag.
export function abstractState({
  hasAbstract,
  withheld,
}: {
  hasAbstract: boolean;
  withheld: boolean;
}): AbstractState {
  if (hasAbstract) return 'available';
  return withheld ? 'withheld' : 'absent';
}
