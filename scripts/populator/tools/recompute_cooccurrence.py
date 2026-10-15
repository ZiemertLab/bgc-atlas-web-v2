#!/usr/bin/env python3
"""Recompute the GCF co-occurrence pair table + enriched table out-of-core in DuckDB.

The in-Postgres self-join of `gcf_sample_presence` spills hundreds of GB and does
not finish, so it runs in DuckDB on a big-memory node. Recompute after any bulk
sample/sample_assemblies change.

  1. export   (Postgres host): COPY the 3 inputs to <workdir> on shared CephFS.
  2. compute  (big node): self-join with count(*), not count(DISTINCT) (the input
              is already distinct, and count(DISTINCT) can't spill), plus metrics
              and enrichment joins. ~1 min for ~44M pairs.
  3. load     (Postgres host): \copy into new tables, index, then one transaction
              drops the old objects and renames *_new into place.

Run `compute` on the big node with the project venv that has duckdb, e.g.:
    ssh <compute-node> '<venv>/bin/python -m scripts.populator.tools.recompute_cooccurrence \
        compute --workdir /data/bgc-atlas/.../duckdb-tmp --threads 32 --memory 128GB'
`export` and `load` run on the Postgres host (localhost). COOCCUR_ENRICHED_DDL must
match gcf_cooccurrence_enriched_mv's columns.
"""
from __future__ import annotations
import argparse
import os
import subprocess
import sys
from pathlib import Path

EXPORTS = {
    # Metagenome samples only: within a single genome, BGCs co-occur by genomic
    # co-location, not ecologically.
    "gcf_sample_presence": (
        "SELECT DISTINCT bg.gcf_id, sa.sample_id "
        "FROM bgcs b JOIN bgc_gcf bg ON bg.bgc_id=b.id AND bg.is_primary "
        # is_primary: counting a multi-family BGC in each family would invent
        # co-occurrence between sibling families.
        "JOIN sample_assemblies sa ON sa.assembly_id=b.assembly "
        "JOIN sample_summary ss ON ss.id=sa.sample_id "
        "WHERE ss.source_types && ARRAY['metagenome']::text[]"
    ),
    "gcf_summary": (
        "SELECT gcf_id, gcf_name, member_bgc_count, product_categories, "
        "unique_product_categories, "
        "(CASE WHEN array_length(product_categories,1)>0 THEN product_categories[1] END) AS first_pc "
        "FROM gcf_summary_mv"
    ),
    "gcf_ecospec_l2": (
        "SELECT gcf_id, level, dominant_ecosystem, dominant_percentage, specificity_category "
        "FROM gcf_ecosystem_specificity_mv WHERE level=2"
    ),
}
# Presence is headerless so DuckDB reads it positionally.
_HEADER = {"gcf_sample_presence": False, "gcf_summary": True, "gcf_ecospec_l2": True}

# The 27 columns of gcf_cooccurrence_enriched_mv, in order, as a CREATE TABLE body.
COOCCUR_ENRICHED_DDL = """(
  gcf_id_a uuid, gcf_id_b uuid, cooccurrence_count bigint,
  gcf_a_total_samples bigint, gcf_b_total_samples bigint, total_samples bigint,
  jaccard_index numeric, expected_cooccurrence numeric, obs_exp_ratio numeric, chi_square_stat numeric,
  significance_category text,
  gcf_a_name varchar(200), gcf_a_bgc_count bigint, gcf_a_product_categories text[], gcf_a_unique_product_count bigint,
  gcf_b_name varchar(200), gcf_b_bgc_count bigint, gcf_b_product_categories text[], gcf_b_unique_product_count bigint,
  product_category_pair text,
  gcf_a_dominant_ecosystem text, gcf_b_dominant_ecosystem text,
  gcf_a_dominant_percentage numeric, gcf_b_dominant_percentage numeric,
  gcf_a_specificity_category text, gcf_b_specificity_category text,
  same_dominant_ecosystem boolean
)"""

BASE_COLS = ("gcf_id_a,gcf_id_b,cooccurrence_count,gcf_a_total_samples,gcf_b_total_samples,"
             "total_samples,jaccard_index,expected_cooccurrence,obs_exp_ratio,chi_square_stat,"
             "significance_category")


def _psql(sql: str, dsn_env: dict) -> str:
    r = subprocess.run(["psql", "-h", "localhost", "-U", os.environ.get("PGUSER", "bgc_owner"),
                        "-d", "bgc_atlas_v2", "-v", "ON_ERROR_STOP=1", "-q", "-c", sql],
                       env=dsn_env, capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f"psql failed:\n{r.stderr}")
    return r.stdout


def phase_export(workdir: Path, dsn_env: dict):
    workdir.mkdir(parents=True, exist_ok=True)
    for name, select in EXPORTS.items():
        dst = workdir / f"{name}.csv"
        hdr = "true" if _HEADER[name] else "false"
        _psql(rf"\copy ({select}) TO '{dst}' WITH (FORMAT csv, HEADER {hdr})", dsn_env)
        print(f"  exported {name} -> {dst}")


def phase_compute(workdir: Path, threads: int, memory: str):
    import duckdb  # only needed on the compute node
    T = str(workdir)
    con = duckdb.connect()
    con.execute(f"SET temp_directory='{T}'")
    con.execute(f"SET memory_limit='{memory}'")
    con.execute(f"SET threads={threads}")
    con.execute("SET preserve_insertion_order=false")
    con.execute(f"CREATE TABLE gsp AS SELECT * FROM read_csv('{T}/gcf_sample_presence.csv', "
                "columns={'gcf_id':'UUID','sample_id':'UUID'}, header=false)")
    con.execute("CREATE TABLE gts AS SELECT gcf_id, count(*) total_samples FROM gsp GROUP BY 1")
    tsc = con.execute("SELECT count(*) FROM (SELECT DISTINCT sample_id FROM gsp)").fetchone()[0]
    exp = f"(gtsa.total_samples::double*gtsb.total_samples)/{tsc}"
    con.execute(f"""CREATE TABLE base AS
      WITH pairs AS (
        SELECT g1.gcf_id a, g2.gcf_id b, count(*) cc
        FROM gsp g1 JOIN gsp g2 ON g1.sample_id=g2.sample_id
        WHERE g1.gcf_id<g2.gcf_id GROUP BY 1,2 HAVING count(*)>=5)
      SELECT p.a gcf_id_a, p.b gcf_id_b, p.cc cooccurrence_count,
        gtsa.total_samples gcf_a_total_samples, gtsb.total_samples gcf_b_total_samples, {tsc} total_samples,
        round(p.cc::double/nullif(gtsa.total_samples+gtsb.total_samples-p.cc,0),4) jaccard_index,
        round({exp},2) expected_cooccurrence,
        round(p.cc::double/nullif({exp},0),3) obs_exp_ratio,
        round(power(p.cc-{exp},2)/nullif({exp},0),3) chi_square_stat,
        CASE WHEN p.cc::double/nullif({exp},0)>=3.0 THEN 'highly_significant_positive'
             WHEN p.cc::double/nullif({exp},0)>=2.0 THEN 'significant_positive'
             WHEN p.cc::double/nullif({exp},0)>=1.5 THEN 'moderate_positive'
             WHEN p.cc::double/nullif({exp},0)<=0.5 THEN 'negative' ELSE 'neutral' END significance_category
      FROM pairs p JOIN gts gtsa ON p.a=gtsa.gcf_id JOIN gts gtsb ON p.b=gtsb.gcf_id""")
    n = con.execute("SELECT count(*) FROM base").fetchone()[0]
    con.execute(f"COPY base TO '{T}/gcf_cooccurrence.csv' (FORMAT csv, HEADER false)")
    con.execute(f"CREATE TABLE sm AS SELECT * FROM read_csv('{T}/gcf_summary.csv', header=true, auto_detect=true)")
    con.execute(f"CREATE TABLE es AS SELECT * FROM read_csv('{T}/gcf_ecospec_l2.csv', header=true, auto_detect=true)")
    con.execute(f"""COPY (
      SELECT b.*,
        ga.gcf_name gcf_a_name, ga.member_bgc_count gcf_a_bgc_count, ga.product_categories gcf_a_product_categories, ga.unique_product_categories gcf_a_unique_product_count,
        gb.gcf_name gcf_b_name, gb.member_bgc_count gcf_b_bgc_count, gb.product_categories gcf_b_product_categories, gb.unique_product_categories gcf_b_unique_product_count,
        CASE WHEN ga.first_pc IS NOT NULL AND gb.first_pc IS NOT NULL THEN ga.first_pc||' × '||gb.first_pc
             WHEN ga.first_pc IS NOT NULL THEN ga.first_pc||' × Unknown'
             WHEN gb.first_pc IS NOT NULL THEN 'Unknown × '||gb.first_pc ELSE 'Unknown × Unknown' END product_category_pair,
        esa.dominant_ecosystem gcf_a_dominant_ecosystem, esb.dominant_ecosystem gcf_b_dominant_ecosystem,
        esa.dominant_percentage gcf_a_dominant_percentage, esb.dominant_percentage gcf_b_dominant_percentage,
        esa.specificity_category gcf_a_specificity_category, esb.specificity_category gcf_b_specificity_category,
        (esa.dominant_ecosystem IS NOT NULL AND esb.dominant_ecosystem IS NOT NULL AND esa.dominant_ecosystem=esb.dominant_ecosystem) same_dominant_ecosystem
      FROM base b
      LEFT JOIN sm ga ON b.gcf_id_a=ga.gcf_id LEFT JOIN sm gb ON b.gcf_id_b=gb.gcf_id
      LEFT JOIN es esa ON b.gcf_id_a=esa.gcf_id LEFT JOIN es esb ON b.gcf_id_b=esb.gcf_id
    ) TO '{T}/gcf_cooccurrence_enriched.csv' (FORMAT csv, HEADER false)""")
    print(f"DONE compute: {n} pairs -> gcf_cooccurrence.csv + gcf_cooccurrence_enriched.csv")


def phase_load(workdir: Path, dsn_env: dict):
    T = str(workdir)
    script = f"""
CREATE TABLE gcf_cooccurrence_new (LIKE gcf_cooccurrence_mv INCLUDING DEFAULTS);
\\copy gcf_cooccurrence_new ({BASE_COLS}) FROM '{T}/gcf_cooccurrence.csv' WITH (FORMAT csv)
CREATE UNIQUE INDEX gcf_cooccur_new_unique ON gcf_cooccurrence_new(gcf_id_a, gcf_id_b);
CREATE INDEX gcf_cooccur_new_a ON gcf_cooccurrence_new(gcf_id_a);
CREATE INDEX gcf_cooccur_new_b ON gcf_cooccurrence_new(gcf_id_b);
CREATE INDEX gcf_cooccur_new_sig ON gcf_cooccurrence_new(significance_category);
CREATE INDEX gcf_cooccur_new_jac ON gcf_cooccurrence_new(jaccard_index DESC);
-- Covering index: makes the /network degree ranking an index-only scan.
CREATE INDEX gcf_cooccur_new_jac_sig ON gcf_cooccurrence_new(jaccard_index, significance_category) INCLUDE (gcf_id_a, gcf_id_b);
ANALYZE gcf_cooccurrence_new;
CREATE TABLE gcf_cooccurrence_enriched_new {COOCCUR_ENRICHED_DDL};
\\copy gcf_cooccurrence_enriched_new FROM '{T}/gcf_cooccurrence_enriched.csv' WITH (FORMAT csv)
CREATE UNIQUE INDEX gcf_cooccur_enrich_new_unique ON gcf_cooccurrence_enriched_new(gcf_id_a, gcf_id_b);
CREATE INDEX gcf_cooccur_enrich_new_pair ON gcf_cooccurrence_enriched_new(product_category_pair);
CREATE INDEX gcf_cooccur_enrich_new_eco ON gcf_cooccurrence_enriched_new(same_dominant_ecosystem);
-- The co-occurrence list sorts by these; without them it seq-scans 14M wide rows.
CREATE INDEX gcf_cooccur_enrich_new_jac ON gcf_cooccurrence_enriched_new(jaccard_index DESC);
CREATE INDEX gcf_cooccur_enrich_new_cc ON gcf_cooccurrence_enriched_new(cooccurrence_count DESC);
-- /network also reads the enriched table; same covering index as the base.
CREATE INDEX gcf_cooccur_enrich_new_jac_sig ON gcf_cooccurrence_enriched_new(jaccard_index, significance_category) INCLUDE (gcf_id_a, gcf_id_b);
ANALYZE gcf_cooccurrence_enriched_new;
BEGIN;
-- Both objects are plain tables after the first cutover.
DROP TABLE IF EXISTS gcf_cooccurrence_enriched_mv;
DROP TABLE IF EXISTS gcf_cooccurrence_mv;
ALTER TABLE gcf_cooccurrence_new RENAME TO gcf_cooccurrence_mv;
ALTER TABLE gcf_cooccurrence_enriched_new RENAME TO gcf_cooccurrence_enriched_mv;
-- Index names are schema-unique and survive a table rename, so move them off
-- *_new or the next run's CREATE INDEX collides.
ALTER INDEX gcf_cooccur_new_unique RENAME TO idx_gcf_cooccur_unique;
ALTER INDEX gcf_cooccur_new_a RENAME TO idx_gcf_cooccur_a;
ALTER INDEX gcf_cooccur_new_b RENAME TO idx_gcf_cooccur_b;
ALTER INDEX gcf_cooccur_new_jac RENAME TO idx_gcf_cooccur_jac;
ALTER INDEX gcf_cooccur_new_jac_sig RENAME TO idx_gcf_cooccur_jac_sig;
ALTER INDEX gcf_cooccur_new_sig RENAME TO idx_gcf_cooccur_sig;
ALTER INDEX gcf_cooccur_enrich_new_unique RENAME TO idx_gcf_cooccur_enrich_unique;
ALTER INDEX gcf_cooccur_enrich_new_pair RENAME TO idx_gcf_cooccur_enrich_pair;
ALTER INDEX gcf_cooccur_enrich_new_eco RENAME TO idx_gcf_cooccur_enrich_eco;
ALTER INDEX gcf_cooccur_enrich_new_jac RENAME TO idx_gcf_cooccur_enrich_jac;
ALTER INDEX gcf_cooccur_enrich_new_cc RENAME TO idx_gcf_cooccur_enrich_cc;
ALTER INDEX gcf_cooccur_enrich_new_jac_sig RENAME TO idx_gcf_cooccur_enrich_jac_sig;
COMMIT;
"""
    sql_path = workdir / "load_swap.sql"
    sql_path.write_text(script)
    r = subprocess.run(["psql", "-h", "localhost", "-U", os.environ.get("PGUSER", "bgc_owner"),
                        "-d", "bgc_atlas_v2", "-v", "ON_ERROR_STOP=1", "-f", str(sql_path)],
                       env=dsn_env, capture_output=True, text=True)
    print(r.stdout)
    if r.returncode:
        raise SystemExit(f"load/swap failed:\n{r.stderr}")
    print("DONE load: gcf_cooccurrence_mv + gcf_cooccurrence_enriched_mv swapped in")
    print("")
    print("NEXT, and NOT optional:")
    print("  1. psql -h localhost -U bgc_owner -d bgc_atlas_v2 -v ON_ERROR_STOP=1 \\")
    print("          -f scripts/clustering-v3/build_cooccurrence_stats.sql")
    print("     The stats panel reads a PRECOMPUTED row (table gcf_cooccurrence_stats).")
    print("     Until it is rebuilt the panel reports the PREVIOUS clustering's numbers,")
    print("     and if the row is missing the route falls back to a live aggregation")
    print("     that scans ~120 GB and starves every other query on the database.")
    print("  2. Bust the Redis keys: gcf-cooccurrence*  (use a read loop, NOT")
    print("     `--scan | xargs DEL` -- keys contain quotes and braces).")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("phase", choices=["export", "compute", "load"])
    ap.add_argument("--workdir", default="/data/bgc-atlas/data-v2/duckdb-tmp")
    ap.add_argument("--threads", type=int, default=32)
    ap.add_argument("--memory", default="128GB")
    a = ap.parse_args(argv)
    wd = Path(a.workdir)
    env = {**os.environ}  # expects PGPASSWORD in the environment
    if a.phase == "export":
        phase_export(wd, env)
    elif a.phase == "compute":
        phase_compute(wd, a.threads, a.memory)
    else:
        phase_load(wd, env)
    return 0


if __name__ == "__main__":
    sys.exit(main())
