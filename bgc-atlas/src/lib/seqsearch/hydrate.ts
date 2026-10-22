// Hydrates only the groups on the current page, or the whole session for the CSV export.
// Read from the bgc_facets index: the Postgres join is one primary-key lookup per BGC, ~120 ms
// each when cold, so a large session's export ran into the statement timeout. The join remains
// for ids the index does not hold (a load newer than the last index build) and for when
// OpenSearch is down.
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { bgcFacetDocs } from '@/lib/opensearch/client';
import { hydrateGcfNames } from '@/lib/opensearch/hydrate';
import { DATA_SOURCE_LABEL } from '@/lib/filters/data-sources';

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

// Shallowest first, as in taxonomies.gtdb_lineage.
const TAX_RANKS = ['tax_domain', 'tax_phylum', 'tax_class', 'tax_order', 'tax_family', 'tax_genus', 'tax_species'];

const FACET_FIELDS = [
  'filename', 'contig', 'product_type', 'product_category', 'sample_id', 'sample_name',
  'data_source', 'gcf_id', ...TAX_RANKS,
];

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** One index document as the shape the join returns; gcfName is filled in afterwards. */
export function facetDocToHydrated(bgcId: string, doc: Record<string, unknown>): HydratedBgc {
  const ranks = TAX_RANKS.map((rank) => str(doc[rank]));
  const deepest = ranks.reduce((last, rank, i) => (rank ? i : last), -1);
  const dataSource = str(doc.data_source);
  return {
    bgcId,
    bgcFilename: str(doc.filename),
    contig: str(doc.contig),
    products: strings(doc.product_type),
    categories: strings(doc.product_category),
    sampleId: str(doc.sample_id),
    sampleName: str(doc.sample_name),
    // The index holds the raw run key (gtdb_genomes_antismash_runs); show the curated label
    // the rest of the site uses for it.
    dataSource: dataSource ? (DATA_SOURCE_LABEL[dataSource] ?? dataSource) : null,
    gcfId: str(doc.gcf_id),
    gcfName: null,
    taxonName: deepest >= 0 ? ranks[deepest] : null,
    taxonLineage: deepest >= 0 ? ranks.slice(0, deepest + 1).map((r) => r ?? '').join(';') : null,
  };
}

async function hydrateFromIndex(ids: string[]): Promise<Record<string, HydratedBgc>> {
  const docs = await bgcFacetDocs(ids, FACET_FIELDS);
  const out: Record<string, HydratedBgc> = {};
  for (const [id, doc] of docs) out[id] = facetDocToHydrated(id, doc);

  const gcfIds = [...new Set(Object.values(out).map((b) => b.gcfId).filter((id): id is string => !!id))];
  if (gcfIds.length) {
    const names = await hydrateGcfNames(gcfIds);
    for (const bgc of Object.values(out)) bgc.gcfName = bgc.gcfId ? names[bgc.gcfId] ?? null : null;
  }
  return out;
}

async function hydrateFromDatabase(ids: string[]): Promise<Record<string, HydratedBgc>> {
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

export async function hydrateBgcs(bgcIds: string[]): Promise<Record<string, HydratedBgc>> {
  const ids = [...new Set(bgcIds.filter(id => UUID_RE.test(id)))]; // guard the ::uuid[] cast
  if (!ids.length) return {};

  let out: Record<string, HydratedBgc> = {};
  try {
    out = await hydrateFromIndex(ids);
  } catch (error) {
    console.warn(`Could not hydrate ${ids.length} BGCs from OpenSearch; using Postgres:`, error);
  }
  const missing = ids.filter(id => !out[id]);
  if (missing.length) Object.assign(out, await hydrateFromDatabase(missing));
  return out;
}
