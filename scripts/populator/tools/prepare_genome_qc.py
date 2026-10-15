#!/usr/bin/env python3
"""Collect published per-genome CheckM values for MAG catalogs that came without them.

  SPIRE MAGs   spire_v1_genome_metadata.tsv.gz, keyed genome_id. gunc_pass is not
               carried: it is 1.0 or empty, so a fail can't be told from never run.
               specI_v4_* rows are isolate references, absent by design.
  TPMC         MAG_summary.xlsx (CheckM v1), keyed '<id>.purify*' -> '<id>'.
  MFD-LR, MFD-SR, OWC
               catalogs_mags.tsv from github.com/Serka-M/MFD-LR (CheckM2 over the
               dereplicated catalogs, so partial for MFD-SR and OWC), joined through
               the MFD accession tables. MFD-LR genomes it leaves out fall back to
               ENA sample records (mfdlr_ena_qc.jsonl from fetch_ena_mag_qc.py).
  GTDB         ar53_metadata_r232.tsv.gz, archaea only (the bacteria already had
               CheckM2 values).
  OMDB         omdb_genome_cols.jsonl from fetch_omdb_genome_qc.py; the CheckM
               columns, not the site's mixed-tool consensus.

Writes data/qc/genome_qc.tsv.gz:
  external_id  completeness  contamination  genome_quality  tool  source
external_id is the samples.external_id spelling ('<prefix>|<genome id>').
genome_quality is MIMAG on CheckM values alone: high >= 90 % complete and <= 5 %
contamination; medium >= 50 % and < 10 %; else low.

Usage:
  prepare_genome_qc.py <download dir> <our_samples.tsv> <out.tsv>

  our_samples.tsv: data_source_name <TAB> external_id  (the MAG samples to cover,
  exported from samples joined to data_sources)

The download dir holds the files listed in SOURCES.
"""
from __future__ import annotations

import csv
import gzip
import json
import math
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from prepare_tpmc_inputs import parse_xlsx_rows  # noqa: E402  (stdlib xlsx reader)

SOURCES = {
    "spire": "https://black.embl.de/~fullam/spire/metadata/spire_v1_genome_metadata.tsv.gz",
    "tpmc": "https://download.cncb.ac.cn/bigd/TPMC/TPMC_genome_catalog/MAG_summary.xlsx",
    "catalogs_mags": "https://raw.githubusercontent.com/Serka-M/MFD-LR/HEAD/data/catalogs/catalogs_mags.tsv",
    "mfd_lr_accessions": "https://raw.githubusercontent.com/cmc-aau/mfd_metadata/main/data/metadata/genome_accessions/long_read_mags_accessions.xlsx",
    "mfd_sr_accessions": "https://raw.githubusercontent.com/cmc-aau/mfd_metadata/main/data/metadata/genome_accessions/short_read_mags_accessions.xlsx",
    "gtdb_ar53": "https://data.gtdb.ecogenomic.org/releases/release232/232.0/ar53_metadata_r232.tsv.gz",
    "mfdlr_ena": "ENA browser API sample records (fetch_ena_mag_qc.py)",
    "omdb": "POST https://omdb.microbiomics.io/api/genome-cols (fetch_omdb_genome_qc.py)",
}

COLUMNS = ["external_id", "completeness", "contamination", "genome_quality", "tool", "source"]


def number(raw) -> float | None:
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def mimag(completeness: float, contamination: float) -> str:
    if completeness >= 90 and contamination <= 5:
        return "high"
    if completeness >= 50 and contamination < 10:
        return "medium"
    return "low"


def checkm_tool(software: str | None) -> str | None:
    """samples.checkm_tool admits CheckM / CheckM2 only; versions and others go unstated."""
    name = (software or "").strip().lower()
    if name.startswith("checkm2"):
        return "CheckM2"
    if name.startswith("checkm"):
        return "CheckM"
    return None


def xlsx_records(path: str) -> list[dict[str, str]]:
    rows = parse_xlsx_rows(open(path, "rb").read())
    header = rows[0]
    return [dict(zip(header, row + [""] * (len(header) - len(row)))) for row in rows[1:]]


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    src_dir, ours_path, out_path = argv

    ours: dict[str, set[str]] = {}
    for name, external_id in csv.reader(open(ours_path), delimiter="\t"):
        ours.setdefault(name, set()).add(external_id)

    out: dict[str, list] = {}

    def put(external_id, completeness, contamination, tool, source):
        c, x = number(completeness), number(contamination)
        if c is None or x is None or external_id in out:
            return
        if not (0 <= c <= 100) or x < 0:
            raise SystemExit(f"{external_id}: implausible QC {c} / {x} from {source}")
        out[external_id] = [external_id, f"{c:g}", f"{x:g}", mimag(c, x), tool, source]

    spire_ids = ours.get("SPIRE MAGs", set())
    with gzip.open(os.path.join(src_dir, "spire_v1_genome_metadata.tsv.gz"), "rt") as fh:
        for row in csv.DictReader(fh, delimiter="\t"):
            eid = f"spire|{row['genome_id']}"
            if eid in spire_ids:
                put(eid, row["completeness"], row["contamination"], None,
                    "SPIRE v1 genome metadata")

    tpmc_ids = ours.get("TPMC", set())
    for row in xlsx_records(os.path.join(src_dir, "tpmc_MAG_summary.xlsx")):
        gid = next(iter(row.values())).rstrip("*")
        gid = gid[: -len(".purify")] if gid.endswith(".purify") else gid
        eid = f"tpmc|{gid}"
        if eid in tpmc_ids:
            put(eid, row["Completeness"], row["Contamination"], "CheckM", "TPMC MAG_summary.xlsx")

    checkm2: dict[tuple[str, str], tuple[str, str]] = {}
    for row in csv.DictReader(open(os.path.join(src_dir, "mfdlr_catalogs_mags.tsv")), delimiter="\t"):
        checkm2[(row["group"], row["bin"])] = (row["checkm2_completeness"], row["checkm2_contamination"])
    cat_source = "MFD-LR catalogs_mags.tsv (Serka-M/MFD-LR)"

    owc_ids = ours.get("OWC", set())
    for (group, bin_id), (c, x) in checkm2.items():
        if group == "OWC" and f"owc|{bin_id}" in owc_ids:
            put(f"owc|{bin_id}", c, x, "CheckM2", cat_source)

    lr_ids = ours.get("Microflora Danica (long-read)", set())
    for row in xlsx_records(os.path.join(src_dir, "mfd_long_read_mags_accessions.xlsx")):
        eid = f"mfd-lr|{row['genome_acc'].split('.')[0]}"
        qc = checkm2.get(("MFD-LR", row["submitted_id"]))
        if eid in lr_ids and qc:
            put(eid, qc[0], qc[1], "CheckM2", cat_source)

    # Only fills what the catalog left empty: put() keeps the first value it sees.
    ena_path = os.path.join(src_dir, "mfdlr_ena_qc.jsonl")
    if os.path.exists(ena_path):
        for line in open(ena_path):
            row = json.loads(line)
            eid = f"mfd-lr|{row['accession'].split('.')[0]}"
            if eid in lr_ids:
                put(eid, row.get("completeness"), row.get("contamination"),
                    checkm_tool(row.get("software")), "ENA sample record")

    sr_ids = ours.get("Microflora Danica (short-read)", set())
    for row in xlsx_records(os.path.join(src_dir, "mfd_short_read_mags_accessions.xlsx")):
        eid = f"mfd-sr|{row['submitted_id']}"
        qc = checkm2.get(("MFD-SR", row["internal_lib_name"]))
        if eid in sr_ids and qc:
            put(eid, qc[0], qc[1], "CheckM2", cat_source)

    gtdb_ids = ours.get("GTDB", set())
    with gzip.open(os.path.join(src_dir, "ar53_metadata_r232.tsv.gz"), "rt") as fh:
        for row in csv.DictReader(fh, delimiter="\t"):
            eid = f"gtdb|{row['accession']}"
            if eid in gtdb_ids:
                put(eid, row["checkm2_completeness"], row["checkm2_contamination"], "CheckM2",
                    "GTDB R232 metadata")

    omdb_ids = ours.get("Ocean Microbiomics Database v2", set())
    omdb_path = os.path.join(src_dir, "omdb_genome_cols.jsonl")
    if os.path.exists(omdb_path):
        for line in open(omdb_path):
            row = json.loads(line)
            eid = f"omd-v2|{row['genome']}"
            if eid in omdb_ids:
                put(eid, row["checkm_completeness"], row["checkm_contamination"], "CheckM",
                    f"OMDB genome table (CheckM {row.get('checkm_version') or 'version not stated'})")

    # .gz for the committed copy (~37 MB plain).
    opener = gzip.open if out_path.endswith(".gz") else open
    with opener(out_path, "wt", newline="") as fh:
        w = csv.writer(fh, delimiter="\t", lineterminator="\n")
        w.writerow(COLUMNS)
        for eid in sorted(out):
            w.writerow(["" if v is None else v for v in out[eid]])

    by_prefix = Counter(eid.split("|", 1)[0] for eid in out)
    tiers = Counter((eid.split("|", 1)[0], row[3]) for eid, row in out.items())
    for prefix, n in sorted(by_prefix.items()):
        total = next((len(v) for k, v in ours.items()
                      if any(e.startswith(prefix + "|") for e in list(v)[:1])), 0)
        print(f"{prefix:8s} {n:>7,} of {total:>7,}  high {tiers[(prefix, 'high')]:,}  "
              f"medium {tiers[(prefix, 'medium')]:,}  low {tiers[(prefix, 'low')]:,}")
    print(f"wrote {len(out):,} rows to {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
