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

// A name field that holds a placeholder rather than a name. One MGnify study
// (MGYS00006083) carries "N/A" as its title, its study_name and so its key, and
// it reached the h1, the list and the share card as "N/A".
const isPlaceholderName = (v: string | null | undefined) =>
  /^\s*(n\/?a|none|null)?\s*$/i.test(v ?? '');

/**
 * The name a study is shown under: its title, then study_name, then study_key --
 * then, only when all three are placeholders, its accession or BioProject. Every
 * place that names a study goes through here, so the h1, the list row and the
 * share card agree.
 */
export function studyTitle(study: {
  title?: string | null;
  study_name?: string | null;
  study_key?: string | null;
  accession?: string | null;
  bioproject?: string | null;
}): string {
  const candidates = [study.title, study.study_name, study.study_key, study.accession, study.bioproject];
  return candidates.find((v) => !isPlaceholderName(v))?.trim() ?? study.study_key ?? '';
}

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
  if (isPlaceholderName(key)) return false;
  if (key.toLowerCase().startsWith('custom_')) return false;

  const same = (other: string | null | undefined) =>
    (other ?? '').trim().toLowerCase() === key.toLowerCase();

  return !identifiers.some(same) && !same(title);
}
