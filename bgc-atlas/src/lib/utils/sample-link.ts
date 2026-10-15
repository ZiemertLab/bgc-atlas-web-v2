// /samples and /genome-collections are one endpoint with different sourceType filters, so a
// link to the wrong one shows an empty table. Matches the /samples/[id] redirect shim.

const GENOME_SOURCE_TYPES = new Set(['isolate', 'MAG', 'SAG']);

export const isGenomeSourceType = (assemblySourceType?: string | null): boolean =>
  GENOME_SOURCE_TYPES.has((assemblySourceType ?? '').trim());

// A bare app path: wrap in withBase() for a raw <a>, but not for a next/link <Link>.
export const sampleBrowseHref = (
  sampleId: string,
  assemblySourceType?: string | null,
): string => {
  const base = isGenomeSourceType(assemblySourceType) ? '/genome-collections' : '/samples';
  return `${base}?id=${encodeURIComponent(sampleId)}`;
};

export const sampleBrowseLabel = (assemblySourceType?: string | null): string =>
  isGenomeSourceType(assemblySourceType) ? 'genome collections' : 'samples';

// A study can hold both kinds, so the caller picks the side from its per-type counts.
export const studySamplesHref = (
  studyKey: string,
  kind: 'metagenome' | 'genome',
): string => {
  const base = kind === 'genome' ? '/genome-collections' : '/samples';
  return `${base}?studyKey=${encodeURIComponent(studyKey)}`;
};
