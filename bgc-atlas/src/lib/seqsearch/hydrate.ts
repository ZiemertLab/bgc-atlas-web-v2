// Hydrates only the groups on the current page; a search can return 100 queries x 1000 targets.
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';

export interface HydratedBgc {
  bgcId: string;
  bgcFilename: string | null;
  contig: string | null;
  products: string[];
  categories: string[];
  sampleId: string | null;
  sampleName: string | null;
  dataSource: string | null;
  gcfId: string | null;
  gcfName: string | null;
  taxonName: string | null;
  taxonLineage: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function hydrateBgcs(bgcIds: string[]): Promise<Record<string, HydratedBgc>> {
  const ids = bgcIds.filter(id => UUID_RE.test(id)); // guards the ::uuid[] cast
  if (!ids.length) return {};

  type Row = {
    bgc_id: string;
    bgc_filename: string | null;
    contig: string | null;
    product: string[] | null;
    product_category: string[] | null;
    sample_id: string | null;
    sample_name: string | null;
    data_source: string | null;
    gcf_id: string | null;
    gcf_name: string | null;
    taxon_name: string | null;
    taxon_lineage: string | null;
  };

  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT DISTINCT ON (b.id)
      b.id::text                      AS bgc_id,
      b.filename                      AS bgc_filename,
      b.contig                        AS contig,
      b.product                       AS product,
      b.product_category              AS product_category,
      s.id::text                      AS sample_id,
      COALESCE(s.name, s.external_id) AS sample_name,
      ds.name                         AS data_source,
      g.id::text                      AS gcf_id,
      g.name                          AS gcf_name,
      COALESCE(t.species, t.genus, t.family, t.order_name, t.class, t.phylum, t.domain) AS taxon_name,
      t.gtdb_lineage                  AS taxon_lineage
    FROM bgcs b
    -- v3 membership is multi-family; is_primary keeps one family per BGC.
    LEFT JOIN bgc_gcf bgf          ON bgf.bgc_id = b.id AND bgf.is_primary
    LEFT JOIN gcfs g               ON g.id = bgf.gcf_id
    LEFT JOIN assemblies a         ON a.id = b.assembly
    LEFT JOIN sample_assemblies sa ON sa.assembly_id = a.id
    LEFT JOIN samples s            ON s.id = sa.sample_id
    -- The sample's data source, not the assembly's, which disagrees for metalog/MGnify rows.
    LEFT JOIN data_sources ds      ON ds.id = s.data_source_ids[1]
    LEFT JOIN bgc_taxonomy bt      ON bt.bgc_id = b.id
    LEFT JOIN taxonomies t         ON t.id = bt.taxonomy_id
    WHERE b.id = ANY(${ids}::uuid[])
    ORDER BY b.id
  `);

  const out: Record<string, HydratedBgc> = {};
  for (const r of rows) {
    out[r.bgc_id] = {
      bgcId: r.bgc_id,
      bgcFilename: r.bgc_filename,
      contig: r.contig,
      products: r.product ?? [],
      categories: r.product_category ?? [],
      sampleId: r.sample_id,
      sampleName: r.sample_name,
      dataSource: r.data_source,
      gcfId: r.gcf_id,
      gcfName: r.gcf_name,
      taxonName: r.taxon_name,
      taxonLineage: r.taxon_lineage,
    };
  }
  return out;
}
