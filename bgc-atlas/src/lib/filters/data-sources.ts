// Curated display labels for the `data_source` facet. Some labels merge several
// raw index values (e.g. the two MGnify runs). Ordered by descending corpus size.

export const DATA_SOURCE_GROUPS: { label: string; raw: string[] }[] = [
  { label: 'MGnify', raw: ['mgnify_antismash_runs', 'mgnify_new_antismash_runs', 'mgnify_new_prodigal_m_runs'] },
  { label: 'SPIRE & metalog', raw: ['metalog_antismash_runs', 'spire_env_only_antismash_runs', 'spire_metalog_added_antismash_runs'] },
  { label: 'GTDB HQ Genomes', raw: ['gtdb_genomes_antismash_runs'] },
  { label: 'OMDB', raw: ['omd-v2'] },
  { label: 'SPIRE MAGs', raw: ['spire'] },
  { label: 'Microflora Danica metagenomes', raw: ['microflora-danica'] },
  { label: 'SMAG', raw: ['smag'] },
  { label: 'GEM', raw: ['gem'] },
  { label: 'TPMC', raw: ['tpmc'] },
  { label: 'MFD-SR MAGs', raw: ['mfd-sr'] },
  { label: 'MFD-LR MAGs', raw: ['mfd-lr'] },
  { label: 'Great Barrier Reef (long-read)', raw: ['great-barrier-reef'] },
  { label: 'Deep-sea hydrothermal', raw: ['deep-sea-hydrothermal'] },
  { label: 'Helgoland 2020 spring bloom', raw: ['helgoland-2020'] },
  { label: 'Ocean surface', raw: ['ocean-surface'] },
  { label: 'Ziemert Lab', raw: ['ziemert-lab'] },
  { label: 'OWC', raw: ['owc'] },
  { label: 'FRAM RAS', raw: ['fram_ras'] },
];

// Options for the query-builder select (value == label; expanded at query time).
export const DATA_SOURCE_OPTIONS = DATA_SOURCE_GROUPS.map((g) => ({ label: g.label, value: g.label }));

// label -> raw index values. Retired labels are kept so saved queries keep their meaning; an
// unknown label would match nothing.
const RETIRED_LABELS: Record<string, string> = { 'OMD-v2': 'OMDB' };

export const DATA_SOURCE_EXPANSION: Record<string, string[]> = {
  ...Object.fromEntries(DATA_SOURCE_GROUPS.map((g) => [g.label, g.raw])),
  ...Object.fromEntries(Object.entries(RETIRED_LABELS).map(([old, current]) => [
    old, DATA_SOURCE_GROUPS.find((g) => g.label === current)!.raw,
  ])),
};
