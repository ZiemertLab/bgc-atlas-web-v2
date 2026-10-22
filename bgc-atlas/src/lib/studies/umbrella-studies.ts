// Umbrella NCBI BioProjects that aren't studies in any meaningful sense — they
// are catch-all pipelines/databases that sweep up tens of thousands of unrelated
// genomes, so their biosynthetic metrics say nothing about a research question
// and their size distorts the ranking. Hidden from the /studies index only; the
// detail route still resolves them so existing links and sample-page references
// work. Still COUNTED in the index headline, with a footnote naming them, so the
// figure matches a count taken from the downloaded database.
//
// No server imports: the /studies page renders this list in its footnote.
// `id` is study_bgc_summary.study_id, which the
// footnote links to: the detail route resolves ids, not keys.
export const UMBRELLA_STUDIES = [
  // 70,676 samples
  { key: 'PRJNA224116', id: 'dfb966c9-4c65-5f3c-95fa-1c044b1766a4', name: 'RefSeq Prokaryotic Genome Annotation Project' },
  // US Food and Drug Administration
  { key: 'PRJNA230969', id: '129a8f8f-105f-5491-bf4a-5375509cd5d6', name: 'GenomeTrakr' },
  // reference genomes for diagnostic use and regulatory science
  { key: 'PRJNA231221', id: 'f37608d1-e949-5bb9-8945-095f79444f41', name: 'FDA-ARGOS' },
] as const;

export const UMBRELLA_STUDY_KEYS: string[] = UMBRELLA_STUDIES.map((s) => s.key);
