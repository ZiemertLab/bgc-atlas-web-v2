import { Prisma } from '@prisma/client';

import prisma from '@/lib/prisma';

// Per-row extras for /genome-collections (GTDB accession, taxonomy, study links), which the
// browse index lacks. Run once for the page's ids via a literal id array, not per corpus sample;
// field names match the SQL path so `mapSampleRowToSample` handles both.

export interface SampleEnrichments {
  gtdbAccession: boolean;
  taxonomy: boolean;
  studyLinks: boolean;
}

interface EnrichmentRow {
  id: string;
  gtdb_accession?: string | null;
  taxonomy?: unknown;
  study_links?: unknown;
}

export const wantsEnrichments = (want: SampleEnrichments): boolean =>
  want.gtdbAccession || want.taxonomy || want.studyLinks;

// An enrichment decorates an already-correct row, so a failed lookup is logged and the documents
// returned unchanged.
export async function hydrateSampleEnrichments(
  documents: Record<string, unknown>[],
  want: SampleEnrichments,
  // Exports pass strict: a file would carry these columns blank with nothing to say why.
  { strict = false }: { strict?: boolean } = {},
): Promise<Record<string, unknown>[]> {
  if (documents.length === 0 || !wantsEnrichments(want)) return documents;

  const ids = documents
    .map((document) => document.id)
    .filter((id): id is string => typeof id === 'string');
  if (ids.length === 0) return documents;

  // The SQL path's subqueries, hung off `s.id` from the id array instead of `sb.id`.
  const gtdbAccession = want.gtdbAccession
    ? Prisma.sql`, (
        SELECT COALESCE(a.external_id, a.accession, a.metadata->>'gtdb_genome_id')
        FROM sample_assemblies sa
        JOIN assemblies a ON a.id = sa.assembly_id
        WHERE sa.sample_id = s.id
          AND COALESCE(a.external_id, a.accession, a.metadata->>'gtdb_genome_id') ~* '(GCF|GCA)_'
        ORDER BY sa.created_at ASC NULLS LAST
        LIMIT 1
      ) AS gtdb_accession`
    : Prisma.empty;

  // Ordered like the SQL path: some genomes carry more than one lineage.
  const taxonomy = want.taxonomy
    ? Prisma.sql`, (
        SELECT jsonb_build_object(
          'domain', at.domain, 'phylum', at.phylum, 'class', at.class,
          'order', at.order_name, 'family', at.family, 'genus', at.genus,
          'species', at.species, 'gtdbLineage', t.gtdb_lineage
        )
        FROM sample_assemblies sa
        JOIN assembly_taxonomy at ON at.assembly_id = sa.assembly_id
        LEFT JOIN taxonomies t ON t.id = at.taxonomy_id
        WHERE sa.sample_id = s.id
        ORDER BY at.n_bgcs DESC, at.assembly_id
        LIMIT 1
      ) AS taxonomy`
    : Prisma.empty;

  const studyLinks = want.studyLinks
    ? Prisma.sql`, (
        SELECT jsonb_agg(jsonb_build_object(
          'accession', st.accession, 'bioproject', st.bioproject, 'title', st.title
        ) ORDER BY st.title NULLS LAST)
        FROM study_samples ss
        JOIN studies st ON st.id = ss.study_id
        WHERE ss.sample_id = s.id
      ) AS study_links`
    : Prisma.empty;

  let rows: EnrichmentRow[];
  try {
    rows = await prisma.$queryRaw<EnrichmentRow[]>`
      SELECT s.id::text AS id ${gtdbAccession} ${taxonomy} ${studyLinks}
        FROM unnest(${ids}::uuid[]) AS s(id)
    `;
  } catch (error) {
    if (strict) throw error;
    console.error('Sample enrichment lookup failed; page served without it', error);
    return documents;
  }

  const byId = new Map(rows.map((row) => [row.id, row]));
  return documents.map((document) => {
    const row = typeof document.id === 'string' ? byId.get(document.id) : undefined;
    if (!row) return document;
    return {
      ...document,
      ...(want.gtdbAccession ? { gtdb_accession: row.gtdb_accession ?? null } : {}),
      ...(want.taxonomy ? { taxonomy: row.taxonomy ?? null } : {}),
      ...(want.studyLinks ? { study_links: row.study_links ?? null } : {}),
    };
  });
}
