#!/usr/bin/env python3
"""Build the BGC-property facet index (sample runner).

Streams facet records from each antiSMASH run tar.gz, joins them to bgcs rows by
(contig, region_number), and writes NDJSON plus a per-source coverage report.

Usage:
    python3 build_facet_index.py --target 30000 --out /path/sample.ndjson [--workers 16]
    python3 build_facet_index.py --runs a.tar.gz b.tar.gz --out out.ndjson
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor, as_completed
from typing import Dict, Iterable, List, Tuple

import psycopg2
import psycopg2.extras

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..")))
from scripts.populator.adapters.antismash_facets import stream_facets_from_tar  # noqa: E402

log = logging.getLogger("build_facet_index")

DBNAME = os.environ.get("PGDATABASE", "bgc_atlas_v2")

# region_number comes from the filename suffix (".region001"). Coordinates can't
# be the join key: the DB stores region-relative coords, the JSON absolute ones.
_PROJ_SQL = """
SELECT b.contig,
       substring(b.filename from '\\.region0*(\\d+)$')::int AS region_number,
       b.id::text AS bgc_id, b.filename,
       b.product AS product_type, b.product_category, b.is_complete, b.gc_content,
       (b.end_pos - b.start_pos) AS length, b.num_cds_features,
       bg.gcf_id::text AS gcf_id, bg.distance AS distance,
       t.domain AS tax_domain, t.phylum AS tax_phylum, t.class AS tax_class,
       t.order_name AS tax_order, t.family AS tax_family,
       t.genus AS tax_genus, t.species AS tax_species
FROM bgcs b
JOIN antismash_runs ar ON b.antismash_run_id = ar.id
LEFT JOIN bgc_gcf bg ON bg.bgc_id = b.id AND bg.is_primary  -- clustering v3: no threshold column; one primary family per BGC
LEFT JOIN bgc_taxonomy bt ON bt.bgc_id = b.id
LEFT JOIN taxonomies t ON t.id = bt.taxonomy_id
WHERE ar.file_path = %s
"""


def resolve_run(
    facet_records: Iterable[dict],
    projections: Dict[Tuple, dict],
) -> Tuple[List[dict], Dict[str, int]]:
    """Merge facet records with DB projections; the DB projection wins on
    overlapping keys. Returns (docs, stats)."""
    docs: List[dict] = []
    matched_keys = set()
    unmatched_regions = 0
    for f in facet_records:
        key = (f.get("contig"), f.get("region_number"))
        proj = projections.get(key)
        if proj is None:
            unmatched_regions += 1
            continue
        matched_keys.add(key)
        docs.append({**f, **proj})
    unmatched_bgcs = sum(1 for k in projections if k not in matched_keys)
    return docs, {
        "matched": len(docs),
        "unmatched_regions": unmatched_regions,
        "unmatched_bgcs": unmatched_bgcs,
    }


def source_of(file_path: str) -> str:
    parts = file_path.split("/data-v2/", 1)
    tail = parts[1] if len(parts) == 2 else file_path
    segs = tail.split("/")
    # mag-collections/<name>/... and custom-datasets/<name>/... -> <name>
    if segs[0] in ("mag-collections", "custom-datasets") and len(segs) > 1:
        return segs[1]
    return segs[0]


def fetch_projections(conn, file_path: str) -> Dict[Tuple, dict]:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(_PROJ_SQL, (file_path,))
        out: Dict[Tuple, dict] = {}
        for row in cur.fetchall():
            d = dict(row)
            key = (d.pop("contig"), d.pop("region_number"))
            out[key] = d
    return out


_CONN = None


def _init_worker():
    global _CONN
    _CONN = psycopg2.connect(dbname=DBNAME)


def _process_run(file_path: str):
    try:
        proj = fetch_projections(_CONN, file_path)
        docs, stats = resolve_run(stream_facets_from_tar(file_path), proj)
        src = source_of(file_path)
        for d in docs:
            d["data_source"] = src
        return file_path, src, docs, stats, None
    except Exception as e:  # noqa: BLE001 - report per-run, keep the batch going
        return file_path, source_of(file_path), [], {
            "matched": 0, "unmatched_regions": 0, "unmatched_bgcs": 0
        }, str(e)


def select_sample_runs(conn, target: int) -> List[str]:
    """Stratified sample of run archives across all sources, ~target BGCs total."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT file_path, num_bgcs FROM antismash_runs
            WHERE file_path IS NOT NULL AND status='completed'
              AND COALESCE(num_bgcs,0) > 0
            ORDER BY file_path
            """
        )
        rows = cur.fetchall()
    by_src: Dict[str, list] = defaultdict(list)
    for fp, n in rows:
        by_src[source_of(fp)].append((fp, n))
    per_src = max(1, target // max(1, len(by_src)))
    chosen: List[str] = []
    for src, runs in sorted(by_src.items()):
        acc = 0
        for fp, n in runs:
            chosen.append(fp)
            acc += n or 0
            if acc >= per_src:
                break
    return chosen


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", type=int, default=30000, help="approx total BGCs to sample")
    ap.add_argument("--runs", nargs="*", help="explicit run archive paths (overrides --target)")
    ap.add_argument("--out", required=True, help="output NDJSON path")
    ap.add_argument("--report", help="coverage report JSON path (default: <out>.report.json)")
    ap.add_argument("--workers", type=int, default=min(16, (os.cpu_count() or 4) - 2))
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    conn = psycopg2.connect(dbname=DBNAME)
    runs = args.runs or select_sample_runs(conn, args.target)
    conn.close()
    log.info("processing %d runs with %d workers", len(runs), args.workers)

    per_src = defaultdict(lambda: {
        "runs": 0, "docs": 0, "matched": 0,
        "unmatched_regions": 0, "unmatched_bgcs": 0, "errors": 0,
    })
    total_docs = 0
    report_path = args.report or (args.out + ".report.json")
    done = 0
    with open(args.out, "w") as out, ProcessPoolExecutor(
        max_workers=args.workers, initializer=_init_worker
    ) as ex:
        futs = [ex.submit(_process_run, fp) for fp in runs]
        for fut in as_completed(futs):
            fp, src, docs, stats, err = fut.result()
            s = per_src[src]
            s["runs"] += 1
            if err:
                s["errors"] += 1
                log.warning("run failed %s: %s", fp, err)
            for d in docs:
                out.write(json.dumps(d, default=str))
                out.write("\n")
            s["docs"] += len(docs)
            s["matched"] += stats["matched"]
            s["unmatched_regions"] += stats["unmatched_regions"]
            s["unmatched_bgcs"] += stats["unmatched_bgcs"]
            total_docs += len(docs)
            done += 1
            if done % 200 == 0:
                log.info("... %d/%d runs, %d docs", done, len(runs), total_docs)

    report = {"total_runs": len(runs), "total_docs": total_docs,
              "by_source": {k: dict(v) for k, v in sorted(per_src.items())}}
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)
    log.info("wrote %d docs to %s", total_docs, args.out)
    log.info("coverage report: %s", report_path)
    for src, v in sorted(per_src.items()):
        log.info("  %-18s runs=%-4d docs=%-6d unmatched_regions=%-4d unmatched_bgcs=%-4d errors=%d",
                 src, v["runs"], v["docs"], v["unmatched_regions"], v["unmatched_bgcs"], v["errors"])


if __name__ == "__main__":
    main()
