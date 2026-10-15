"""Prepare the committed TSV input for the GEM (Genomes from Earth's Microbiomes)
metadata backfill: ``data/gem/gem_genome_metadata.tsv``, sorted by genome_id.

Run:
    scripts/populator/.venv/bin/python -m scripts.populator.tools.prepare_gem_inputs
"""
from __future__ import annotations

import argparse
import csv
import pathlib
import sys
import urllib.request

_THIS = pathlib.Path(__file__).resolve()
REPO_ROOT = _THIS.parents[3]  # <repo>/scripts/populator/tools/prepare_gem_inputs.py
GEM_DIR = REPO_ROOT / "scripts" / "populator" / "data" / "gem"
GEM_METADATA_TSV = GEM_DIR / "gem_genome_metadata.tsv"

GEM_METADATA_URL = "https://portal.nersc.gov/GEM/genomes/genome_metadata.tsv"

OUTPUT_COLUMNS = [
    "genome_id", "metagenome_id", "latitude", "longitude", "ecosystem_category",
    "ecosystem_type", "habitat", "completeness", "contamination", "mimag_quality",
    "genome_length", "otu_id", "taxonomy",
]
# The GEM column named `ecosystem` actually holds the GTDB taxonomy string.
SOURCE_COLUMN = {out: out for out in OUTPUT_COLUMNS}
SOURCE_COLUMN["taxonomy"] = "ecosystem"

# The catalog has ~52,515 genomes; fewer means a truncated or garbage HTTP 200.
_MIN_ROWS = 50000


def parse_gem_tsv(text: str, min_rows: int = _MIN_ROWS) -> list:
    """Parse the GEM TSV into ``OUTPUT_COLUMNS``-ordered rows sorted by genome_id,
    mapping columns by header name. Raises ``ValueError`` on a missing source column
    or fewer than ``min_rows`` rows, so the committed file is never clobbered.
    """
    lines = text.splitlines()
    if not lines:
        raise ValueError("empty GEM metadata response")
    header = lines[0].split("\t")
    idx = {name: i for i, name in enumerate(header)}
    missing = [SOURCE_COLUMN[c] for c in OUTPUT_COLUMNS if SOURCE_COLUMN[c] not in idx]
    if missing:
        raise ValueError(
            f"unexpected GEM response header: missing source column(s) {missing} "
            f"in {header[:16]}...")

    out = []
    for line in lines[1:]:
        if not line.strip():
            continue
        cells = line.split("\t")
        row = []
        for out_col in OUTPUT_COLUMNS:
            i = idx[SOURCE_COLUMN[out_col]]
            row.append(cells[i] if i < len(cells) else "")
        out.append(row)
    if len(out) < min_rows:
        raise ValueError(
            f"GEM metadata parsed only {len(out)} rows (< sanity floor {min_rows}); "
            "refusing to overwrite the committed file")
    out.sort(key=lambda r: r[0])  # by genome_id
    return out


def fetch_gem_text(url: str = GEM_METADATA_URL, timeout: int = 600) -> str:
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        raw = resp.read()
    return raw.decode("utf-8", errors="replace")


def _write_tsv(out_path, header, rows) -> int:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh, delimiter="\t", lineterminator="\n")
        w.writerow(header)
        w.writerows(rows)
    return len(rows)


def write_gem_metadata(rows, out_path=GEM_METADATA_TSV) -> int:
    return _write_tsv(out_path, OUTPUT_COLUMNS, rows)


def main(argv=None) -> int:
    argparse.ArgumentParser(
        description="Prepare the GEM backfill input TSV.").parse_args(argv)

    try:
        text = fetch_gem_text()
        rows = parse_gem_tsv(text)
    except Exception as exc:  # noqa: BLE001 - surface any fetch/parse failure as exit 1
        print(f"ERROR: GEM metadata not written (committed file left intact): {exc}",
              file=sys.stderr)
        return 1
    n = write_gem_metadata(rows)
    print(f"wrote {GEM_METADATA_TSV} ({n} data rows)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
