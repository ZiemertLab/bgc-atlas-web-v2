#!/usr/bin/env python3
"""Build the load TSV for the uniform CheckM2 1.1.0 run.

Every non-GTDB genome-collection genome was run through CheckM2 1.1.0: 525,287 in the full run plus 18,528
from an earlier gap-fill run. Those values REPLACE the published ones. GTDB keeps GTDB R232's CheckM2 values;
only the 40 GTDB genomes R232 lacks, which had none, come from the gap-fill run.

Input (<qc dir>):
  manifest.tsv + checkm2-results/chunk_*/quality_report.tsv                    gap-fill run
  full-20261008/manifest.tsv + full-20261008/results/chunk_*/quality_report.tsv full run
Manifest rows: source, samples.external_id, FASTA path, run name (= quality_report Name).

Output columns match backfill_genome_qc.sql's input:
  external_id completeness contamination genome_quality tool source

Usage: prepare_uniform_checkm2.py <qc dir> <out.tsv.gz>
"""
import csv
import glob
import gzip
import os
import sys

from prepare_genome_qc import mimag

TOOL = "CheckM2"
SOURCE = "BGC Atlas CheckM2 1.1.0 run (2026-10)"


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    qc_dir, out_path = argv
    runs = (
        (os.path.join(qc_dir, "manifest.tsv"), os.path.join(qc_dir, "checkm2-results")),
        (os.path.join(qc_dir, "full-20261008", "manifest.tsv"), os.path.join(qc_dir, "full-20261008", "results")),
    )

    name_to_ext: dict[str, str] = {}
    for manifest, _ in runs:
        for source, external_id, _path, name in csv.reader(open(manifest), delimiter="\t"):
            if name in name_to_ext:
                raise SystemExit(f"{name}: in more than one manifest")
            name_to_ext[name] = external_id

    out: dict[str, list[str]] = {}
    for _, results in runs:
        for report in sorted(glob.glob(os.path.join(results, "chunk_*", "quality_report.tsv"))):
            for row in csv.DictReader(open(report), delimiter="\t"):
                external_id = name_to_ext.get(row["Name"])
                if external_id is None:
                    raise SystemExit(f"{report}: {row['Name']} is in no manifest")
                if external_id in out:
                    raise SystemExit(f"{external_id}: reported twice")
                c, x = float(row["Completeness"]), float(row["Contamination"])
                if not (0 <= c <= 100) or x < 0:
                    raise SystemExit(f"{external_id}: implausible QC {c} / {x}")
                out[external_id] = [external_id, f"{c:g}", f"{x:g}", mimag(c, x), TOOL, SOURCE]

    missing = sorted(set(name_to_ext.values()) - set(out))
    # The two GTDB genomes NCBI no longer serves are in the gap-fill manifest but were never run.
    unexpected = [m for m in missing if not m.startswith("gtdb|")]
    if unexpected:
        raise SystemExit(f"{len(unexpected)} manifest genomes have no result, e.g. {unexpected[:3]}")

    with gzip.open(out_path, "wt", newline="") as fh:
        w = csv.writer(fh, delimiter="\t", lineterminator="\n")
        w.writerow(["external_id", "completeness", "contamination", "genome_quality", "tool", "source"])
        for external_id in sorted(out):
            w.writerow(out[external_id])
    n_gtdb = sum(1 for e in out if e.startswith("gtdb|"))
    print(f"wrote {len(out)} rows ({len(out) - n_gtdb} non-GTDB, {n_gtdb} GTDB without R232 values); "
          f"manifest genomes with no result: {len(missing)} (GTDB, not served by NCBI)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
