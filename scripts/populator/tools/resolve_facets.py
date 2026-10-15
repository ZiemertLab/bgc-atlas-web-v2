#!/usr/bin/env python3
"""Phase 2 of the facet backfill: resolve + project (runs on the database host, DB-local).

Joins the Phase-1 facet shards to each run's bgcs projection by (contig,
region_number) and writes the indexable NDJSON corpus plus a coverage report.
Phase 1 keeps each run within one shard, so shards can be processed one by one.

Usage:
  python3 resolve_facets.py --shards-dir /data/bgc-atlas/.../shards \
      --out /data/bgc-atlas/.../corpus.ndjson.gz --report /data/bgc-atlas/.../coverage.json
"""
from __future__ import annotations

import argparse
import glob
import gzip
import json
import os
import sys
import time
from collections import defaultdict

import psycopg2
import psycopg2.extras

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..")))
from scripts.populator.tools.build_facet_index import resolve_run, source_of  # noqa: E402

DBNAME = os.environ.get("PGDATABASE", "bgc_atlas_v2")

_PROJ_SQL = """
SELECT DISTINCT ON (b.id) ar.file_path,
       b.contig,
       substring(b.filename from '\\.region0*(\\d+)$')::int AS region_number,
       b.id::text AS bgc_id, b.filename,
       b.product AS product_type, b.product_category, b.is_complete, b.gc_content,
       (b.end_pos - b.start_pos) AS length, b.num_cds_features,
       bg.gcf_id::text AS gcf_id, bg.distance AS distance,
       t.domain AS tax_domain, t.phylum AS tax_phylum, t.class AS tax_class,
       t.order_name AS tax_order, t.family AS tax_family,
       t.genus AS tax_genus, t.species AS tax_species,
       a.source_type AS sample_type,
       s.id::text AS sample_id,
       COALESCE(s.name, s.external_id) AS sample_name,
       s.environment_biome AS biome,
       s.environment_feature AS env_feature,
       s.environment_material AS env_material,
       s.environmental_package AS env_package,
       s.host_scientific_name AS host,
       s.geolocation_name AS geolocation,
       s.latitude AS latitude, s.longitude AS longitude,
       s.gold_ecosystem_path AS gold_ecosystem,
       EXTRACT(YEAR FROM s.collection_date)::int AS collection_year
FROM bgcs b
JOIN antismash_runs ar ON b.antismash_run_id = ar.id
LEFT JOIN bgc_gcf bg ON bg.bgc_id = b.id AND bg.is_primary  -- clustering v3: no threshold column; one primary family per BGC
LEFT JOIN bgc_taxonomy bt ON bt.bgc_id = b.id
LEFT JOIN taxonomies t ON t.id = bt.taxonomy_id
LEFT JOIN assemblies a ON b.assembly = a.id
LEFT JOIN sample_assemblies sa ON sa.assembly_id = a.id
LEFT JOIN samples s ON sa.sample_id = s.id
WHERE b.antismash_run_id = ANY(%s::uuid[])
ORDER BY b.id, s.id NULLS LAST
"""


def load_runid_map(conn) -> dict:
    with conn.cursor() as cur:
        cur.execute("SELECT id::text, file_path FROM antismash_runs WHERE file_path IS NOT NULL")
        return {fp: rid for rid, fp in cur.fetchall()}


def fetch_projections(conn, run_ids) -> dict:
    per_run = defaultdict(dict)
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(_PROJ_SQL, (run_ids,))
        for row in cur.fetchall():
            d = dict(row)
            fp = d.pop("file_path")
            key = (d.pop("contig"), d.pop("region_number"))
            per_run[fp][key] = d
    return per_run


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shards-dir", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--report", required=True)
    args = ap.parse_args()

    conn = psycopg2.connect(dbname=DBNAME)
    runid_by_path = load_runid_map(conn)
    shards = sorted(glob.glob(os.path.join(args.shards_dir, "shard_*.ndjson.gz")))
    print(f"{len(shards)} shards; {len(runid_by_path)} known runs", flush=True)

    per_src = defaultdict(lambda: {"docs": 0, "matched": 0,
                                   "unmatched_regions": 0, "unmatched_bgcs": 0})
    total = 0
    t0 = time.time()
    with gzip.open(args.out, "wt") as out:
        for si, shard in enumerate(shards, 1):
            recs_by_run = defaultdict(list)
            for line in gzip.open(shard, "rt"):
                r = json.loads(line)
                recs_by_run[r["file_path"]].append(r)
            run_ids = [runid_by_path[fp] for fp in recs_by_run if fp in runid_by_path]
            projs = fetch_projections(conn, run_ids) if run_ids else {}
            for fp, recs in recs_by_run.items():
                docs, stats = resolve_run(recs, projs.get(fp, {}))
                src = source_of(fp)
                s = per_src[src]
                for d in docs:
                    d.pop("file_path", None)  # provenance, not a facet field
                    d["data_source"] = src
                    out.write(json.dumps(d, default=str))
                    out.write("\n")
                s["docs"] += len(docs)
                s["matched"] += stats["matched"]
                s["unmatched_regions"] += stats["unmatched_regions"]
                s["unmatched_bgcs"] += stats["unmatched_bgcs"]
                total += len(docs)
            if si % 20 == 0 or si == len(shards):
                print(f"  {si}/{len(shards)} shards | {total} docs | "
                      f"{total/(time.time()-t0):.0f} docs/s", flush=True)

    report = {"total_docs": total, "shards": len(shards),
              "by_source": {k: dict(v) for k, v in sorted(per_src.items())}}
    with open(args.report, "w") as f:
        json.dump(report, f, indent=2)
    print(f"wrote {total} docs -> {args.out}\nreport -> {args.report}", flush=True)
    for src, v in sorted(per_src.items()):
        print(f"  {src:28s} docs={v['docs']:<8d} unmatched_regions={v['unmatched_regions']:<6d} "
              f"unmatched_bgcs={v['unmatched_bgcs']}", flush=True)


if __name__ == "__main__":
    main()
