#!/usr/bin/env python3
"""Turn mmseqs easy-taxonomy ``*_lca.tsv`` files into bgc_taxonomy load rows (orf_lca_v1).

The incremental counterpart of scripts/clustering-v2/build_taxonomy_v2.py, for a
subset of BGCs re-run through the same ORF-LCA call (mmseqs vs GTDB R232,
``--lca-ranks superkingdom,...,species --tax-lineage 1``). Reads the raw lca.tsv
instead of taxonomy_assignments.parquet, and normalizes through the same
gtdb_taxonomy helpers, so a lineage comes out byte-identical to the full load's.

lca.tsv columns: bgc_id, taxid, rank, name, n_orfs, n_assigned, n_agree, support,
lineage_names, lineage_ranked. The rank values come from ``lineage_ranked``
(``d_Bacteria;p_Bacillota;...``, spaces kept in GTDB suffixes); ``lineage_names``
pads with ``uc_`` placeholders and is not used.

A row gets no output (= unclassified) when support < 0.5, or when it carries no
domain (``-_root``, empty). Both match the full load.

Outputs (--out):
  lineages.tsv   taxonomies rows: lineage, d..s (prefixed), source, is_partial, rank_depth
  pred.tsv       bgc_id, lineage, rank, support
  report.txt

Usage:
  python3 build_lca_taxonomy_rows.py --out DIR shard_0_lca.tsv [...]
"""
import argparse
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "clustering-v2"))
from gtdb_taxonomy import RANKS, canonical_lineage, is_partial, rank_depth, split_gtdb_lineage  # noqa: E402

# lineage_ranked prefix -> rank position
POS = {"d_": 0, "p_": 1, "c_": 2, "o_": 3, "f_": 4, "g_": 5, "s_": 6}
RANK_ALIASES = {"superkingdom": "domain"}
MIN_SUPPORT = 0.5


def parse_ranked(lineage_ranked):
    """'d_Bacteria;p_Bacillota;...' -> seven rank values (None where absent)."""
    values = [None] * len(RANKS)
    for part in lineage_ranked.split(";") if lineage_ranked else []:
        pos = POS.get(part[:2])
        if pos is not None and part[2:]:
            values[pos] = part[2:]
    return values


def convert(row):
    """One lca.tsv row -> (bgc_id, lineage, rank, support, called_rank) or a skip reason."""
    bgc_id, _taxid, called, _name, _n, _a, _g, support, _names, ranked = row
    s = float(support) if support else 0.0
    if s < MIN_SUPPORT:
        return "unclassified"
    lineage = canonical_lineage(parse_ranked(ranked))
    if not lineage:
        return "no_domain"
    return bgc_id, lineage, RANKS[rank_depth(lineage) - 1], s, RANK_ALIASES.get(called, called)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("lca", nargs="+")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    lineages = set()
    seen = set()
    skipped = Counter()
    ranks = Counter()
    mismatch = Counter()
    rows = 0
    with open(os.path.join(args.out, "pred.tsv"), "w") as out:
        for path in args.lca:
            for line in open(path):
                cols = line.rstrip("\n").split("\t")
                if len(cols) != 10:
                    sys.exit(f"{path}: expected 10 columns, got {len(cols)}: {line[:200]!r}")
                rows += 1
                if cols[0] in seen:
                    sys.exit(f"duplicate bgc_id {cols[0]}")
                seen.add(cols[0])
                r = convert(cols)
                if isinstance(r, str):
                    skipped[r] += 1
                    continue
                bgc_id, lineage, rank, support, called = r
                if called != rank:
                    mismatch[(called, rank)] += 1
                lineages.add(lineage)
                ranks[rank] += 1
                out.write(f"{bgc_id}\t{lineage}\t{rank}\t{support:.4f}\n")

    with open(os.path.join(args.out, "lineages.tsv"), "w") as fh:
        for lineage in sorted(lineages):
            cols = [lineage]
            for prefix, value in zip(["d__", "p__", "c__", "o__", "f__", "g__", "s__"], split_gtdb_lineage(lineage)):
                cols.append(prefix + value if value else "\\N")
            cols += ["orf_lca_v1", "t" if is_partial(lineage) else "f", str(rank_depth(lineage))]
            fh.write("\t".join(cols) + "\n")

    with open(os.path.join(args.out, "report.txt"), "w") as fh:
        def emit(s=""):
            print(s, file=fh)
            print(s)
        emit(f"lca rows           {rows:,}")
        emit(f"  written          {sum(ranks.values()):,}")
        for k, v in sorted(skipped.items()):
            emit(f"  skipped {k:10} {v:,}")
        emit(f"distinct lineages  {len(lineages):,}")
        for rank in RANKS:
            if ranks[rank]:
                emit(f"  {rank:9} {ranks[rank]:,}")
        if mismatch:
            emit("called rank != lineage depth (depth used):")
            for (c, r), n in mismatch.most_common(10):
                emit(f"  {c} -> {r}: {n:,}")


if __name__ == "__main__":
    main()
