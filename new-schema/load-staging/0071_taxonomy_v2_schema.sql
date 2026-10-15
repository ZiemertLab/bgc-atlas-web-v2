-- Migration 0071: taxonomy v2 schema (pre-stage; creates new empty tables only).
--
-- A side table rather than rewriting bgcs.taxonomy_id: updating an indexed column on
-- ~16.4M bgcs rows rewrites every index entry and stalls the site.
-- bgc_taxonomy has no PK/indexes/FKs so the bulk COPY is fast; 0072 adds them.

BEGIN;

-- Unclassified BGCs get no row, so a LEFT JOIN yields NULL where taxonomy is unknown.
CREATE TABLE IF NOT EXISTS bgc_taxonomy (
    bgc_id      uuid  NOT NULL,
    taxonomy_id uuid  NOT NULL,
    rank        text  NOT NULL,
    -- Not a useful quality filter: genus accuracy is ~92% above and below 0.8.
    support     real,
    method      text  NOT NULL
);

-- Staging, dropped in 0072. Columns match build_taxonomy_v2.py's TSVs positionally,
-- so `\copy <table> FROM <file>` needs no column list.

-- taxonomies_new.tsv
CREATE TABLE IF NOT EXISTS tax_stage_lineages (
    gtdb_lineage text,
    domain       text,
    phylum       text,
    class        text,
    order_name   text,
    family       text,
    genus        text,
    species      text,
    source       text,
    is_partial   boolean,
    rank_depth   integer
);

-- bgc_pred_tax.tsv
CREATE TABLE IF NOT EXISTS tax_stage_pred (
    bgc_id       uuid,
    gtdb_lineage text,
    rank         text,
    support      real
);

-- gtdb_asm_tax.tsv
CREATE TABLE IF NOT EXISTS tax_stage_gtdb (
    accession    text,
    gtdb_lineage text
);

COMMENT ON TABLE  bgc_taxonomy        IS 'Authoritative per-BGC taxonomy (taxonomy v2). Replaces bgcs.taxonomy_id.';
COMMENT ON COLUMN bgc_taxonomy.rank   IS 'Deepest rank called; equals the depth of the joined taxonomies.gtdb_lineage.';
COMMENT ON COLUMN bgc_taxonomy.support IS 'ORF-LCA agreement fraction (0.5-1.0); NULL when genome-derived.';
COMMENT ON COLUMN bgc_taxonomy.method IS 'gtdb_r232 = genome-derived (GTDB isolates); orf_lca_v1 = predicted.';

COMMIT;
