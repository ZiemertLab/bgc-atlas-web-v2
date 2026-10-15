#!/usr/bin/env python3
"""Emit denormalized browse documents from PostgreSQL.

Browse indexes are sourced from the relational projections that back the API
routes, so PostgreSQL stays the single source of truth.

Usage:
  python3 build_browse_corpus.py --entity gcfs --out /data/bgc-atlas/gcfs_v1.ndjson.gz
  python3 build_browse_corpus.py --entity samples --out /data/bgc-atlas/samples_v1.ndjson.gz
"""
from __future__ import annotations

import argparse
import dataclasses
import datetime as dt
import gzip
import json
import os
from decimal import Decimal
from typing import Any, Iterator

import psycopg2
import psycopg2.extras

try:
    from scripts.populator.tools.gcf_dominant_taxon import dominant_fields
except ImportError:  # pragma: no cover - direct `python tools/...` invocation
    from gcf_dominant_taxon import dominant_fields

DBNAME = os.environ.get("PGDATABASE", "bgc_atlas_v2")


def database_connection_args() -> dict[str, str]:
    database_url = os.environ.get("DATABASE_URL")
    return {"dsn": database_url} if database_url else {"dbname": DBNAME}


@dataclasses.dataclass(frozen=True)
class BrowseIndexConfig:
    id_field: str
    sql: str


# Keep these close to the list routes. New browse filters need a field here and
# in the OpenSearch mapping.
BROWSE_INDEX_CONFIGS: dict[str, BrowseIndexConfig] = {
    "bgcs": BrowseIndexConfig(
        id_field="bgc_id",
        sql="""
            SELECT b.id::text AS bgc_id, b.filename, b.contig,
                   b.assembly::text AS assembly_id, bg.gcf_id::text AS gcf_id,
                   b.product AS product_type, b.product_category, b.is_complete,
                   -- bgc_gcf.distance, lower = better
                   b.gc_content, bg.distance AS distance,
                   (b.end_pos - b.start_pos) AS length,
                   b.start_pos AS start, b.end_pos AS end, b.num_cds_features,
                   b.antismash_run_id::text AS antismash_run_id, b.anchor,
                   ar.file_path AS archive_path,
                   go.gbk_offset, go.gbk_length,
                   a.source_type AS assembly_source_type, g.name AS gcf_name,
                   t.domain AS tax_domain, t.phylum AS tax_phylum,
                   t.class AS tax_class, t.order_name AS tax_order,
                   t.family AS tax_family, t.genus AS tax_genus,
                   t.species AS tax_species, t.gtdb_lineage,
                   -- What the /bgcs taxonomy sort orders by; OpenSearch cannot
                   -- sort a COALESCE, so it is precomputed.
                   COALESCE(t.species, t.genus, t.family, t.order_name,
                            t.class, t.phylum, t.domain) AS taxonomy_sort,
                   bbs.resolved_biome_level_1, bbs.resolved_biome_level_2,
                   bbs.resolved_biome_level_3, bbs.resolved_biome_level_4,
                   bbs.environment_biome, bbs.environment_feature,
                   bbs.environment_material,
                   asm.sample_ids::text[] AS sample_ids,
                   COALESCE(asm.sample_labels, ARRAY[]::text[]) AS sample_labels,
                   asm.gold_ecosystem_path,
                   asm.gold_ecosystem_metadata,
                   -- Exact only while an assembly has one point: enrich_document()
                   -- refuses geo_point_count > 1 (see geo_scroll_reindex.py).
                   geo.latitude, geo.longitude, geo.point_count AS geo_point_count,
                   COALESCE(ds.data_source_names, ARRAY[]::text[]) AS data_source_names,
                   COALESCE(ds.data_source_ids, ARRAY[]::text[]) AS data_source_ids
            FROM bgcs b
            LEFT JOIN assemblies a ON a.id = b.assembly
            -- Primary family only, to match the Postgres fallback's
            -- `bg.is_primary` filter.
            LEFT JOIN bgc_gcf bg ON bg.bgc_id = b.id AND bg.is_primary
            LEFT JOIN gcfs g ON g.id = bg.gcf_id
            LEFT JOIN antismash_runs ar ON ar.id = b.antismash_run_id
            LEFT JOIN bgc_gbk_offsets go ON go.bgc_id = b.id
            LEFT JOIN bgc_taxonomy bt ON bt.bgc_id = b.id
            LEFT JOIN taxonomies t ON t.id = bt.taxonomy_id
            LEFT JOIN bgc_biome_summary_mv bbs ON bbs.bgc_id = b.id
            LEFT JOIN assembly_samples_mv asm ON asm.assembly_id = b.assembly
            -- Aggregated per assembly so the join stays 1:1.
            LEFT JOIN (
                SELECT sa.assembly_id,
                       min(s.latitude)::float8 AS latitude,
                       min(s.longitude)::float8 AS longitude,
                       count(DISTINCT (s.latitude, s.longitude)) AS point_count
                  FROM sample_assemblies sa
                  JOIN samples s ON s.id = sa.sample_id
                 WHERE s.latitude IS NOT NULL AND s.longitude IS NOT NULL
                 GROUP BY sa.assembly_id
            ) geo ON geo.assembly_id = b.assembly
            LEFT JOIN LATERAL (
                SELECT array_agg(DISTINCT source.name ORDER BY source.name) AS data_source_names,
                       array_agg(DISTINCT source.id::text ORDER BY source.id::text) AS data_source_ids
                FROM sample_summary ss
                CROSS JOIN LATERAL unnest(ss.data_source_ids, ss.data_source_names) AS source(id, name)
                WHERE ss.id = ANY(asm.sample_ids)
            ) ds ON true
            ORDER BY b.id
        """,
    ),
    "gcfs": BrowseIndexConfig(
        id_field="gcf_id",
        sql="""
            -- No `g.gcf_id::text AS gcf_id`: gcf_summary_mv already has gcf_id, and
            -- the duplicate column breaks CREATE TABLE AS.
            SELECT g.*,
                   -- pet_name is not in gcf_summary_mv.
                   gsrc.pet_name AS pet_name,
                   COALESCE(gd.biome_distribution_l1, '{}'::jsonb) AS biome_distribution_l1,
                   COALESCE(gd.biome_distribution_l2, '{}'::jsonb) AS biome_distribution_l2,
                   COALESCE(gd.biome_distribution_l3, '{}'::jsonb) AS biome_distribution_l3,
                   COALESCE(gd.biome_distribution_l4, '{}'::jsonb) AS biome_distribution_l4,
                   COALESCE(gd.biome_distribution_l5, '{}'::jsonb) AS biome_distribution_l5,
                   COALESCE(gd.product_category_distribution, '{}'::jsonb) AS product_category_distribution,
                   COALESCE(ptd.dist, '{}'::jsonb) AS product_type_distribution,
                   COALESCE(tax_dist.domain_distribution, '{}'::jsonb) AS taxonomy_distribution,
                   COALESCE(tax_dist.rank_distributions, '{}'::jsonb) AS taxonomy_distributions,
                   gd.max_pct_l1, gd.max_pct_l2, gd.max_pct_l3,
                   gd.max_pct_l4, gd.max_pct_l5,
                   -- From SQL rather than derived here, so the browse index and
                   -- the SQL fallback answer the advanced filter identically.
                   gd.dom_ecosystem_l1, gd.dom_ecosystem_l3,
                   -- Member shares per category (overlapping) and categories at
                   -- >= 50%, from SQL so the fallback agrees. NULL (absent) when no
                   -- member carries it. Names: browse_index_mapping.PRODUCT_CATEGORIES.
                   (gd.category_member_share ->> 'NRPS')::float8       AS category_share_nrps,
                   (gd.category_member_share ->> 'PKS')::float8        AS category_share_pks,
                   (gd.category_member_share ->> 'RiPP')::float8       AS category_share_ripp,
                   (gd.category_member_share ->> 'terpene')::float8    AS category_share_terpene,
                   (gd.category_member_share ->> 'saccharide')::float8 AS category_share_saccharide,
                   (gd.category_member_share ->> 'other')::float8      AS category_share_other,
                   COALESCE(gd.majority_categories, ARRAY[]::text[]) AS majority_categories,
                   -- length_est is precomputed because OpenSearch cannot sort a
                   -- COALESCE; for families with no complete member it is a floor.
                   gl.median_complete_len, gl.min_len, gl.max_len,
                   COALESCE(gl.median_complete_len, gl.max_len) AS length_est,
                   -- study_count = 1 means the family is exclusive to its study.
                   COALESCE(sg.study_keys, ARRAY[]::text[]) AS study_keys,
                   COALESCE(gsc.study_count, 0) AS study_count,
                   -- gcf_mibig_anchor covers few families, so this lateral almost always misses.
                   COALESCE(mib.anchored, false) AS mibig_anchored,
                   COALESCE(mib.accessions, ARRAY[]::text[]) AS mibig_accessions,
                   COALESCE(mib.compounds, ARRAY[]::text[]) AS mibig_compounds,
                   -- resolved_biome_level_1..3 of every member (GOLD and ENVO mixed),
                   -- not biome_distribution_l* (the GOLD path).
                   COALESCE(bt.terms, ARRAY[]::text[]) AS biome_terms,
                   -- Over primary members, read from bgcs as the SQL filter does.
                   -- Not gcf_product_type_matrix_mv (pre-0116 it dropped labels) nor
                   -- taxonomy_distributions (counts non-primary rows, invents *__Unknown).
                   COALESCE(prt.terms, ARRAY[]::text[]) AS product_terms,
                   COALESCE(txt.terms, ARRAY[]::text[]) AS taxonomy_terms
            FROM gcf_summary_mv g
            LEFT JOIN gcfs gsrc ON gsrc.id = g.gcf_id
            LEFT JOIN gcf_length_stats_mv gl ON gl.gcf_id = g.gcf_id
            LEFT JOIN gcf_distributions_mv gd ON gd.gcf_id = g.gcf_id
            LEFT JOIN LATERAL (
                SELECT jsonb_object_agg(pt, ROUND(100.0 * cnt / total, 1)) AS dist
                FROM (
                    SELECT m.product AS pt, SUM(m.bgc_count) AS cnt,
                           SUM(SUM(m.bgc_count)) OVER () AS total
                    FROM gcf_product_type_matrix_mv m
                    WHERE m.gcf_id = g.gcf_id
                    GROUP BY m.product
                ) per_type
                WHERE total > 0
            ) ptd ON true
            LEFT JOIN gcf_taxonomy_distribution_mv tax_dist ON tax_dist.gcf_id = g.gcf_id
            LEFT JOIN gcf_study_count gsc ON gsc.gcf_id = g.gcf_id
            LEFT JOIN LATERAL (
                SELECT array_agg(sg2.study_key) AS study_keys
                FROM study_gcf sg2 WHERE sg2.gcf_id = g.gcf_id
            ) sg ON true
            LEFT JOIN LATERAL (
                -- compounds is text[] per reference; DISTINCT removes repeats across references.
                SELECT true AS anchored,
                       array_agg(DISTINCT a.mibig_accession) AS accessions,
                       (SELECT array_agg(DISTINCT c)
                          FROM gcf_mibig_anchor a2, unnest(a2.compounds) AS c
                         WHERE a2.gcf_id = g.gcf_id) AS compounds
                FROM gcf_mibig_anchor a WHERE a.gcf_id = g.gcf_id
                HAVING count(*) > 0
            ) mib ON true
            LEFT JOIN LATERAL (
                SELECT array_agg(DISTINCT v ORDER BY v) AS terms
                FROM gcf_environmental_distribution_mv e,
                     LATERAL (VALUES (e.biome_level_1), (e.biome_level_2),
                                     (e.biome_level_3)) AS lv(v)
                WHERE e.gcf_id = g.gcf_id AND v IS NOT NULL
            ) bt ON true
            -- Aggregates joined on gcf_id, not laterals: a lateral into bgcs per
            -- family is millions of random reads.
            LEFT JOIN (
                SELECT bg.gcf_id, array_agg(DISTINCT p ORDER BY p) AS terms
                FROM bgc_gcf bg JOIN bgcs b ON b.id = bg.bgc_id, unnest(b.product) AS p
                WHERE bg.is_primary AND p IS NOT NULL AND p <> ''
                GROUP BY bg.gcf_id
            ) prt ON prt.gcf_id = g.gcf_id
            LEFT JOIN (
                SELECT ft.gcf_id, array_agg(DISTINCT v ORDER BY v) AS terms
                FROM (SELECT DISTINCT bg.gcf_id, btx.taxonomy_id
                      FROM bgc_gcf bg JOIN bgc_taxonomy btx ON btx.bgc_id = bg.bgc_id
                      WHERE bg.is_primary) ft
                JOIN taxonomies t ON t.id = ft.taxonomy_id,
                     LATERAL (VALUES (t.domain), (t.phylum), (t.class), (t.order_name),
                                     (t.family), (t.genus), (t.species)) AS rk(v)
                WHERE v IS NOT NULL AND v <> ''
                GROUP BY ft.gcf_id
            ) txt ON txt.gcf_id = g.gcf_id
            -- `listed` excludes fragmented singletons and seed families with no
            -- primary member.
            WHERE g.listed
            ORDER BY g.gcf_id
        """,
    ),
    "samples": BrowseIndexConfig(
        id_field="sample_id",
        sql="""
            WITH sample_study_keys AS (
                SELECT ss.sample_id,
                       array_agg(DISTINCT COALESCE(NULLIF(st.study_name, ''),
                                                   st.accession, st.id::text)) AS study_keys
                  FROM study_samples ss
                  JOIN studies st ON st.id = ss.study_id
                 GROUP BY ss.sample_id
            )
            -- sample_summary's columns spelled out, not sb.*: the corpus is materialised with CREATE TABLE
            -- AS, which rejects duplicate column names, and data_source_ids is re-selected below as text[]
            -- (psycopg2 returns uuid[] as one string). A new sample_summary column must be added here.
            SELECT
                   sb.id, sb.external_id, sb.name, sb.description, sb.geographic_location, sb.geolocation_name,
                   sb.location_resolution, sb.latitude, sb.longitude, sb.depth, sb.depth_min_meters,
                   sb.depth_max_meters, sb.elevation_meters, sb.temperature, sb.ph, sb.salinity, sb.salinity_unit,
                   sb.current_precipitation_mm, sb.mean_annual_precipitation_mm, sb.mean_annual_temperature,
                   sb.environmental_package, sb.environment_biome, sb.primary_biome, sb.environment_feature,
                   sb.environment_material, sb.host_taxid, sb.host_scientific_name, sb.sample_alias, sb.accession,
                   sb.collection_date, sb.collection_date_end, sb.metadata, sb.gold_ecosystem_path,
                   sb.gold_ecosystem_metadata, sb.created_at, sb.updated_at, sb.assembly_count, sb.bgc_count,
                   sb.data_source_names, sb.study_titles, sb.source_types,
                   sb.id::text AS sample_id,
                   sb.data_source_ids::text[] AS data_source_ids,
                   -- salinity, salinity_unit, temperature and ph come from sb above (sample_summary
                   -- carries them); selecting them from s as well would duplicate the columns.
                   s.dissolved_oxygen, s.dissolved_oxygen_unit,
                   s.nitrate, s.nitrate_unit, s.nitrite, s.nitrite_unit,
                   s.ammonium, s.ammonium_unit, s.phosphate, s.phosphate_unit,
                   s.conductivity, s.conductivity_unit,
                   s.dissolved_organic_carbon, s.dissolved_organic_carbon_unit,
                   s.filtration_lower_threshold_um, s.filtration_upper_threshold_um,
                   s.checkm_completeness, s.checkm_contamination, s.genome_size,
                   -- Which tool and source the CheckM values came from (migration 0121).
                   s.checkm_tool, s.checkm_source,
                   s.genome_quality,
                   -- Clustering-dependent: rebuild this index after re-clustering.
                   -- COALESCE so a sample with no BGCs indexes as 0.
                   COALESCE(sgc.gcf_count, 0) AS gcf_count,
                   COALESCE(sgc.clustered_bgc_count, 0) AS clustered_bgc_count,
                   COALESCE(sgc.unclustered_bgc_count, 0) AS unclustered_bgc_count,
                   -- Keys, not titles: titles are shared by several studies. Same
                   -- expression study_bgc_summary keys on. Aggregated once in the CTE;
                   -- a per-sample LATERAL took ~8 minutes across the corpus.
                   COALESCE(sk.study_keys, '{}') AS study_keys
            FROM sample_summary sb
            JOIN samples s ON s.id = sb.id
            LEFT JOIN sample_gcf_counts_mv sgc ON sgc.sample_id = sb.id
            LEFT JOIN sample_study_keys sk ON sk.sample_id = sb.id
            WHERE sb.external_id IS NOT NULL
            ORDER BY sb.id
        """,
    ),
}


def _json_value(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (dt.date, dt.datetime)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): _json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_value(item) for item in value]
    return value


def normalize_document(row: dict[str, Any]) -> dict[str, Any]:
    """Make a DB row JSON-safe without changing false/zero/empty-array semantics."""
    return {key: _json_value(value) for key, value in row.items() if value is not None}


def enrich_document(entity: str, document: dict[str, Any]) -> dict[str, Any]:
    """Fields derived from the projection rather than selected by it.

    dom_<rank> fields are derived here so a corpus rebuild produces them rather
    than relying on an in-place backfill a rebuild would drop.
    """
    if entity == "gcfs":
        document.update(dominant_fields(document.get("taxonomy_distributions")))
    if entity == "bgcs":
        points = document.pop("geo_point_count", None)
        if points is not None and points > 1:
            raise ValueError(
                f"assembly {document.get('assembly_id')} has {points} distinct sample "
                "points; latitude/longitude are scalars and would keep only one. "
                "See geo_scroll_reindex.py.")
    return document


def iter_documents(conn, entity: str, config: BrowseIndexConfig, fetch_size: int) -> Iterator[dict[str, Any]]:
    # work_mem is per plan node per worker and doubled by hash_mem_multiplier;
    # 64MB with default parallelism stays around 1.5 GB. Disabling parallelism
    # slows the bgcs corpus by over an order of magnitude.
    with conn.cursor() as setup:
        setup.execute("SET work_mem = '64MB'")
        # Batch job: outruns the app's 120s statement_timeout.
        setup.execute("SET statement_timeout = 0")
    # Materialise first, then cursor: PostgreSQL never runs a parallel plan inside
    # a named (suspendable) cursor, which made the bgcs corpus take most of a day.
    # CREATE UNLOGGED TABLE AS gets the parallel plan.
    # MATERIALISE FIRST, THEN CURSOR.
    #
    # PostgreSQL will not run a parallel plan inside a suspendable cursor, and this is
    # a named (server-side) cursor. The planner produces a Parallel Hash Left Join when
    # the same SQL is EXPLAINed, but the running cursor gets ZERO parallel workers and
    # streams so slowly that the bgcs corpus would take most of a day.
    # Setting max_parallel_workers_per_gather makes no difference; the cursor is what
    # disqualifies the parallel plan.
    #
    # CREATE UNLOGGED TABLE ... AS is a single non-suspendable statement, so it gets the
    # parallel plan. Cursoring the flat result afterwards is a plain sequential scan.
    # UNLOGGED because this is scratch that never needs to survive a crash, and it keeps
    # the write off the WAL.
    tmp = f"_browse_corpus_{entity}"
    with conn.cursor() as ddl:
        ddl.execute(f"DROP TABLE IF EXISTS {tmp}")
        ddl.execute(f"CREATE UNLOGGED TABLE {tmp} AS {config.sql}")
        ddl.execute(f"SELECT count(*) FROM {tmp}")
        print(f"  materialised {ddl.fetchone()[0]:,} rows into {tmp}", flush=True)
    conn.commit()
    try:
        with conn.cursor(name="browse_corpus",
                         cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.itersize = fetch_size
            cur.execute(f"SELECT * FROM {tmp}")
            for row in cur:
                document = normalize_document(dict(row))
                if not document.get(config.id_field):
                    raise ValueError(f"missing {config.id_field} in browse projection")
                yield enrich_document(entity, document)
    finally:
        conn.rollback()
        with conn.cursor() as ddl:
            ddl.execute(f"DROP TABLE IF EXISTS {tmp}")
        conn.commit()


def open_output(path: str):
    return gzip.open(path, "wt") if path.endswith(".gz") else open(path, "w")


RUN_ANCHOR = "\n            ORDER BY b.id\n"


def narrow_to_runs(config: BrowseIndexConfig, path: str) -> BrowseIndexConfig:
    """The bgcs projection for the BGCs of the given antiSMASH runs only.

    For re-ingesting a cohort (~1.8M BGCs of 20k runs): narrowing on the run index
    keeps the CTAS's parallel hash joins, where the browse_subset_patch narrowing by
    bgc id fetches everything into memory. The ids go in as a validated literal.
    """
    import uuid
    ids = sorted({str(uuid.UUID(line.strip())) for line in open(path) if line.strip()})
    if not ids:
        raise SystemExit(f"{path}: no run ids")
    if config.sql.count(RUN_ANCHOR) != 1:
        raise SystemExit("bgcs projection: narrowing anchor not found exactly once")
    literal = "'{" + ",".join(ids) + "}'::uuid[]"
    print(f"  narrowed to {len(ids):,} antiSMASH runs", flush=True)
    return dataclasses.replace(config, sql=config.sql.replace(
        RUN_ANCHOR, f"\n            WHERE b.antismash_run_id = ANY({literal})" + RUN_ANCHOR))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--entity", required=True, choices=sorted(BROWSE_INDEX_CONFIGS))
    parser.add_argument("--out", required=True, help="NDJSON or NDJSON.GZ output path")
    parser.add_argument("--fetch-size", type=int, default=10_000)
    parser.add_argument("--antismash-runs", help="bgcs only: emit just the BGCs of these run ids (one per line)")
    args = parser.parse_args()

    config = BROWSE_INDEX_CONFIGS[args.entity]
    if args.antismash_runs:
        if args.entity != "bgcs":
            parser.error("--antismash-runs applies to --entity bgcs only")
        config = narrow_to_runs(config, args.antismash_runs)
    count = 0
    with psycopg2.connect(**database_connection_args()) as conn, open_output(args.out) as out:
        for document in iter_documents(conn, args.entity, config, args.fetch_size):
            out.write(json.dumps(document, separators=(",", ":"), default=str))
            out.write("\n")
            count += 1
            if count % 500_000 == 0:
                print(f"{args.entity}: {count} documents", flush=True)
    print(f"wrote {count} {args.entity} documents to {args.out}", flush=True)


if __name__ == "__main__":
    main()
