// Study identifiers are a mixed list; some custom studies use their DOI as the accession.
export const isBioProject = (v: string) => /^PRJ[A-Z]+\d+$/i.test(v.trim());

/** Bare form (`10.1038/s41586-025-09794-2`), not a doi.org URL. */
export const isDoi = (v: string) => /^10\.\d{4,9}\/\S+$/.test(v.trim());

export const bioprojectUrl = (v: string) =>
  `https://www.ncbi.nlm.nih.gov/bioproject/${encodeURIComponent(v.trim())}`;

// encodeURI, not encodeURIComponent: DOI suffixes contain slashes.
export const doiUrl = (v: string) => `https://doi.org/${encodeURI(v.trim())}`;

export const pubmedUrl = (v: string) =>
  `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(v.trim())}/`;

/**
 * `study_key` is COALESCE(study_name, accession, id), a join key that usually duplicates an
 * accession or the title; only author slugs like `CritsChristoph_2018_soil` earn a chip.
 * `custom_*` keys are internal. Pass the title as rendered (it falls back to study_key).
 */
export function showStudyKey(
  studyKey: string | null | undefined,
  { identifiers, title }: { identifiers: string[]; title: string | null | undefined },
): boolean {
  const key = (studyKey ?? '').trim();
  if (!key) return false;
  if (key.toLowerCase().startsWith('custom_')) return false;

  const same = (other: string | null | undefined) =>
    (other ?? '').trim().toLowerCase() === key.toLowerCase();

  return !identifiers.some(same) && !same(title);
}
