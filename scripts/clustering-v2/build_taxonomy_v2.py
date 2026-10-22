#!/usr/bin/env python3
"""Build the taxonomy v2 load files (COPY-ready TSVs) offline; no database access.

Inputs (all under data-v2/clustering-v2/taxonomy/):
  taxonomy_assignments.parquet   per-BGC ORF-LCA calls
  bac120_taxonomy.tsv            GTDB R232 bacteria  (md5 4d42e137...)
  ar53_taxonomy_r232.tsv         GTDB R232 archaea   (md5 c8e9aa53...)

Outputs (--out):
  taxonomies_new.tsv   distinct canonical lineages + parsed rank columns
  bgc_pred_tax.tsv     bgc_id, lineage, rank, support   (classified predictions)
  gtdb_asm_tax.tsv     assemblies.accession, lineage    (GTDB reference)
  build_report.txt     counts and consistency checks

Usage:
  .venv/bin/python build_taxonomy_v2.py --out /data/bgc-atlas/.../taxonomy/load-v2
"""
import argparse
import os
import sys
from collections import Counter

import pyarrow.parquet as pq

from gtdb_taxonomy import (
    RANKS,
    canonical_lineage,
    is_partial,
    rank_depth,
    split_gtdb_lineage,
)

TAXDIR = "/data/bgc-atlas/data-v2/clustering-v2/taxonomy"
PARQUET = os.path.join(TAXDIR, "taxonomy_assignments.parquet")
BAC120 = os.path.join(TAXDIR, "bac120_taxonomy.tsv")
AR53 = os.path.join(TAXDIR, "ar53_taxonomy_r232.tsv")

# taxonomy_assignments.parquet uses NCBI rank vocabulary; the atlas uses GTDB's.
RANK_ALIASES = {"superkingdom": "domain"}

BATCH = 1_000_000


def log(*args):
    print(*args, flush=True)


def read_reference(path, label, lineages, out_fh):
    """Stream a GTDB reference file to gtdb_asm_tax.tsv, collecting its lineages."""
    n = 0
    for line in open(path):
        accession, _, lineage = line.rstrip("\n").partition("\t")
        if not accession or not lineage:
            continue
        # Same canonicalizer as the predictions.
        canonical = canonical_lineage(split_gtdb_lineage(lineage))
        if not canonical:
            continue
        lineages.setdefault(canonical, "gtdb_r232")
        # assemblies.accession stores GTDB genomes as 'gtdb|<accession>'.
        out_fh.write(f"gtdb|{accession}\t{canonical}\n")
        n += 1
    log(f"  {label}: {n:,} genomes")
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="output directory (use CephFS)")
    ap.add_argument("--limit", type=int, default=0, help="stop after N parquet rows")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    for path in (PARQUET, BAC120, AR53):
        if not os.path.exists(path):
            sys.exit(f"missing input: {path}")

    # lineage -> taxonomies.source; 'gtdb_r232' wins when both sources have a lineage.
    lineages: dict[str, str] = {}

    log("reading GTDB R232 reference ...")
    gtdb_path = os.path.join(args.out, "gtdb_asm_tax.tsv")
    with open(gtdb_path, "w") as fh:
        n_bac = read_reference(BAC120, "bac120", lineages, fh)
        n_ar = read_reference(AR53, "ar53", lineages, fh)
    log(f"  {len(lineages):,} distinct reference lineages")

    log("streaming taxonomy_assignments.parquet ...")
    pred_path = os.path.join(args.out, "bgc_pred_tax.tsv")
    rows = 0
    written = 0
    unclassified = 0
    empty_lineage = 0
    rank_mismatch = Counter()
    rank_counts = Counter()
    depth_counts = Counter()

    parquet = pq.ParquetFile(PARQUET)
    with open(pred_path, "w") as fh:
        for batch in parquet.iter_batches(
            batch_size=BATCH,
            columns=["bgc_id", "rank", "support", "classified"] + RANKS,
        ):
            d = batch.to_pydict()
            for i in range(len(d["bgc_id"])):
                rows += 1
                if not d["classified"][i]:
                    unclassified += 1
                    continue
                lineage = canonical_lineage([d[r][i] for r in RANKS])
                if not lineage:
                    empty_lineage += 1
                    continue

                rank = RANK_ALIASES.get(d["rank"][i], d["rank"][i])
                depth = rank_depth(lineage)
                # A mismatch means the parquet's rank columns disagree with its `rank` field.
                if rank not in RANKS or RANKS[depth - 1] != rank:
                    rank_mismatch[(d["rank"][i], depth)] += 1
                    rank = RANKS[depth - 1]

                lineages.setdefault(lineage, "orf_lca_v1")
                support = d["support"][i]
                support_col = "" if support is None else f"{support:.4f}"
                fh.write(f"{d['bgc_id'][i]}\t{lineage}\t{rank}\t{support_col}\n")
                written += 1
                rank_counts[rank] += 1
                depth_counts[depth] += 1

            if rows % (4 * BATCH) == 0:
                log(f"  {rows:,} rows")
            if args.limit and rows >= args.limit:
                break

    log(f"  {rows:,} rows -> {written:,} prediction assignments")

    log("writing taxonomies_new.tsv ...")
    tax_path = os.path.join(args.out, "taxonomies_new.tsv")
    with open(tax_path, "w") as fh:
        for lineage, source in sorted(lineages.items()):
            values = split_gtdb_lineage(lineage)
            cols = [lineage]
            # taxonomies stores the prefixed form per rank ('p__Bacillota').
            for prefix, value in zip(["d__", "p__", "c__", "o__", "f__", "g__", "s__"], values):
                cols.append(prefix + value if value else "\\N")
            cols.append(source)
            cols.append("t" if is_partial(lineage) else "f")
            cols.append(str(rank_depth(lineage)))
            fh.write("\t".join(cols) + "\n")
    log(f"  {len(lineages):,} distinct lineages")

    report = os.path.join(args.out, "build_report.txt")
    with open(report, "w") as fh:
        def emit(line=""):
            print(line, file=fh)
            log(line)

        emit("taxonomy v2 build report")
        emit("=" * 60)
        emit(f"reference genomes      bac120 {n_bac:,}  ar53 {n_ar:,}")
        emit(f"parquet rows           {rows:,}")
        emit(f"  unclassified         {unclassified:,}")
        emit(f"  empty lineage        {empty_lineage:,}")
        emit(f"  written              {written:,}")
        emit(f"distinct lineages      {len(lineages):,}")
        emit()
        emit("prediction calls by rank:")
        for rank in RANKS:
            if rank_counts[rank]:
                emit(f"  {rank:9} {rank_counts[rank]:,}")
        emit()
        emit("prediction lineage depth:")
        for depth in sorted(depth_counts):
            emit(f"  depth {depth}: {depth_counts[depth]:,}")
        if rank_mismatch:
            emit()
            emit("WARNING rank field disagreed with the rank columns "
                 f"({sum(rank_mismatch.values()):,} rows, depth used instead):")
            for (raw, depth), n in rank_mismatch.most_common(10):
                emit(f"  rank={raw!r} depth={depth}: {n:,}")

    log(f"\nwrote {tax_path}\n      {pred_path}\n      {gtdb_path}\n      {report}")


if __name__ == "__main__":
    main()
