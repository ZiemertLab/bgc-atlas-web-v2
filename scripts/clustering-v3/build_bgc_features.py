#!/usr/bin/env python3
"""clustering-v3 offline build: bgc_features.csv, a COPY-ready 1:1 projection of
master_atlas_v3.parquet (no database access).

placement_status is not in the v3 master and is derived from membership, not route
(a contained-route BGC can have no seed family yet a fragmented one); it agrees
row-for-row with bgc_gcf:

    gcf_04 IS NOT NULL           -> placed
    residual_gcf_04 IS NOT NULL  -> residual_family
    neither                      -> unplaced

Streams with pyarrow rather than DuckDB, which can OOM or hang reading from CephFS.

Run with the project venv:
    .venv/bin/python build_bgc_features.py

Paths come from bundle_config.py (CLUSTERING_SRC, CLUSTERING_BUILD). Output goes under
CLUSTERING_BUILD by default (local / is small and shared with Postgres). Override with:
    CLUSTERING_V3_BGC_FEATURES_OUT=/some/roomy/fs/bgc_features.csv \
    .venv/bin/python build_bgc_features.py
"""
from __future__ import annotations

import csv
import os
import re
import sys
import time

import pyarrow.parquet as pq

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bundle_config as cfg  # noqa: E402

SRC = cfg.SRC
BUILD = cfg.BUILD

DEFAULT_OUT = os.path.join(BUILD, "out", "bgc_features.csv")
BGC_FEATURES_CSV = os.environ.get("CLUSTERING_V3_BGC_FEATURES_OUT", DEFAULT_OUT)

BATCH_SIZE = int(os.environ.get("CLUSTERING_V3_BATCH_SIZE", "65536"))

# Order must match the bgc_features table.
COLUMNS = [
    "bgc_id", "completeness_class", "route", "placement_status", "final_cluster_id",
    "n_biosynthetic", "n_biosynthetic_add", "n_regulatory", "n_transport",
    "n_resistance", "n_other", "hypothetical_count", "n_pfam_domain", "n_asdomain",
    "n_asmodule", "asdomain_types_ordered", "sec_met_domains", "core_gene_types",
    "ordered_asdomain_string", "cand_kinds", "n_protoclusters", "proto_core_span_bp",
    "hybrid_structure", "contig_length", "contig_edge", "warnings", "record_id",
    "region", "primary_category",
]
ARRAY_COLS = frozenset(
    {"asdomain_types_ordered", "sec_met_domains", "core_gene_types",
     "cand_kinds", "warnings"}
)
BOOL_COLS = frozenset({"contig_edge"})

READ_COLUMNS = [c for c in COLUMNS if c != "placement_status"] + [
    "gcf_04", "residual_gcf_04"]

EXPECT_PLACEMENT = cfg.expect()["placement"]

EXPECT_ROWS = cfg.expect()["features_rows"]

_ARRAY_QUOTE_RE = re.compile(r'[,{}"\\\s]')


def pg_array_literal(items) -> str:
    """Postgres array literal for CSV COPY: None -> "" (NULL), [] -> "{}".

    csv.writer adds its own outer quoting, which CSV COPY strips again.
    """
    if items is None:
        return ""
    if len(items) == 0:
        return "{}"
    parts = []
    for e in items:
        if e is None:
            parts.append("NULL")
            continue
        e = str(e)
        if e == "" or _ARRAY_QUOTE_RE.search(e):
            e = e.replace("\\", "\\\\").replace('"', '\\"')
            parts.append('"' + e + '"')
        else:
            parts.append(e)
    return "{" + ",".join(parts) + "}"


def pg_bool(v) -> str:
    if v is None:
        return ""
    return "t" if v else "f"


def encode_scalar(v):
    """An unquoted empty field is NULL to CSV COPY."""
    return "" if v is None else v


_SEC_MET_IDX = COLUMNS.index("sec_met_domains")
_FINAL_IDX = COLUMNS.index("final_cluster_id")


def _encode_batch(batch):
    """Columns are bound to locals once per batch to keep dict lookups out of the hot loop."""
    d = batch.to_pydict()
    bgc_id = d["bgc_id"]
    completeness_class = d["completeness_class"]
    route = d["route"]
    gcf_04 = d["gcf_04"]
    residual_gcf_04 = d["residual_gcf_04"]
    final_cluster_id = d["final_cluster_id"]
    n_biosynthetic = d["n_biosynthetic"]
    n_biosynthetic_add = d["n_biosynthetic_add"]
    n_regulatory = d["n_regulatory"]
    n_transport = d["n_transport"]
    n_resistance = d["n_resistance"]
    n_other = d["n_other"]
    hypothetical_count = d["hypothetical_count"]
    n_pfam_domain = d["n_pfam_domain"]
    n_asdomain = d["n_asdomain"]
    n_asmodule = d["n_asmodule"]
    asdomain_types_ordered = d["asdomain_types_ordered"]
    sec_met_domains = d["sec_met_domains"]
    core_gene_types = d["core_gene_types"]
    ordered_asdomain_string = d["ordered_asdomain_string"]
    cand_kinds = d["cand_kinds"]
    n_protoclusters = d["n_protoclusters"]
    proto_core_span_bp = d["proto_core_span_bp"]
    hybrid_structure = d["hybrid_structure"]
    contig_length = d["contig_length"]
    contig_edge = d["contig_edge"]
    warnings = d["warnings"]
    record_id = d["record_id"]
    region = d["region"]
    primary_category = d["primary_category"]

    S = encode_scalar
    A = pg_array_literal
    B = pg_bool

    rows = []
    null_final = 0
    placement_counts = {"placed": 0, "residual_family": 0, "unplaced": 0}
    for i in range(len(bgc_id)):
        fc = final_cluster_id[i]
        if fc is None:
            null_final += 1
        if gcf_04[i] is not None:
            placement = "placed"
        elif residual_gcf_04[i] is not None:
            placement = "residual_family"
        else:
            placement = "unplaced"
        placement_counts[placement] += 1
        rows.append([
            S(bgc_id[i]), S(completeness_class[i]), S(route[i]),
            S(placement), S(fc),
            S(n_biosynthetic[i]), S(n_biosynthetic_add[i]), S(n_regulatory[i]),
            S(n_transport[i]), S(n_resistance[i]), S(n_other[i]),
            S(hypothetical_count[i]), S(n_pfam_domain[i]), S(n_asdomain[i]),
            S(n_asmodule[i]),
            A(asdomain_types_ordered[i]), A(sec_met_domains[i]),
            A(core_gene_types[i]), S(ordered_asdomain_string[i]),
            A(cand_kinds[i]), S(n_protoclusters[i]), S(proto_core_span_bp[i]),
            S(hybrid_structure[i]), S(contig_length[i]),
            B(contig_edge[i]), A(warnings[i]), S(record_id[i]),
            S(region[i]), S(primary_category[i]),
        ])
    return rows, null_final, placement_counts


def _fmt_sample(row) -> str:
    return "\n".join(f"    {c:24s} = {row[j]!r}" for j, c in enumerate(COLUMNS))


def main() -> int:
    t0 = time.time()
    out_parent = os.path.dirname(os.path.abspath(BGC_FEATURES_CSV))
    os.makedirs(out_parent, exist_ok=True)

    print("=" * 68)
    print("clustering-v3 build_bgc_features — bgc_features 1:1 load table")
    print("=" * 68)
    master = cfg.master_path()
    print(f"  master     : {master}")
    print(f"  output CSV : {BGC_FEATURES_CSV}")
    print(f"  batch size : {BATCH_SIZE:,}")
    print(f"  columns    : {len(COLUMNS)}")

    pf = pq.ParquetFile(master)
    print(f"  master rows: {pf.metadata.num_rows:,}  row groups: {pf.num_row_groups}")

    rows_written = 0
    null_final = 0
    placement_totals = {"placed": 0, "residual_family": 0, "unplaced": 0}
    sample_first = None
    sample_array = None

    # Big buffer to cut CephFS write syscalls.
    with open(
        BGC_FEATURES_CSV, "w", newline="", encoding="utf-8", buffering=1 << 20
    ) as fh:
        w = csv.writer(fh, lineterminator="\n")
        w.writerow(COLUMNS)

        b = 0
        for batch in pf.iter_batches(batch_size=BATCH_SIZE, columns=READ_COLUMNS):
            rows, batch_null, batch_placement = _encode_batch(batch)
            w.writerows(rows)
            rows_written += len(rows)
            null_final += batch_null
            for k, v in batch_placement.items():
                placement_totals[k] += v

            if sample_first is None and rows:
                sample_first = rows[0]
            if sample_array is None:
                for r in rows:
                    if r[_SEC_MET_IDX] not in ("", "{}"):
                        sample_array = r
                        break

            b += 1
            if b % 25 == 0:
                print(f"  ... {rows_written:,} rows  ({time.time() - t0:.0f}s)",
                      flush=True)

    size = os.path.getsize(BGC_FEATURES_CSV)
    elapsed = time.time() - t0
    null_frac = (null_final / rows_written) if rows_written else 0.0

    print("\n" + "-" * 68)
    print(f"  rows written           : {rows_written:,}")
    print(f"  output path            : {BGC_FEATURES_CSV}")
    print(f"  output size            : {size:,} bytes ({size / 1e9:.2f} GB)")
    print(f"  final_cluster_id NULL  : {null_final:,} ({null_frac:.2%})")
    print(f"  wall                   : {elapsed:.1f}s")
    print("-" * 68)

    print("\n  placement_status:")
    placement_ok = True
    for key in ("placed", "residual_family", "unplaced"):
        got, want = placement_totals[key], EXPECT_PLACEMENT[key]
        flag = "" if got == want else f"   <-- FAIL, expected {want:,}"
        if got != want:
            placement_ok = False
        print(f"    {key:<18s} {got:>12,d}{flag}")
    if not placement_ok:
        print("  PLACEMENT COUNTS DO NOT MATCH")
        return 1

    if sample_first is not None:
        print("\n  sample row [0]:")
        print(_fmt_sample(sample_first))
    if sample_array is not None:
        print("\n  sample row with a non-empty array (sec_met_domains):")
        print(_fmt_sample(sample_array))
    else:
        print("\n  (no row with a non-empty sec_met_domains array was seen)")

    if rows_written != EXPECT_ROWS:
        print("\n" + "-" * 68)
        print(f"VALIDATION FAILED: wrote {rows_written:,} data rows != "
              f"expected {EXPECT_ROWS:,}")
        print("-" * 68)
        return 1

    print(f"\n  VALIDATION PASSED — {rows_written:,} rows (== {EXPECT_ROWS:,}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
