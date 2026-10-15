"""Prepare the two committed TSV inputs for the SMAG (Global Soil MAGs) metadata backfill.

Outputs, from the SMAG paper's supplementary workbooks:
  * ``data/smag/smag_sample_metadata.tsv`` from Zenodo "Supplementary Data 1.xlsx"
    (a title row precedes the header row).
  * ``data/smag/smag_genome_qc.tsv`` from the GitHub "Extended Data Table 2.xlsx".

Stdlib only. Sorted by ``user_genome``, this reproduces the committed files
byte-for-byte. QC ``classification`` comes from ``GTDB_pplacer_taxonomy``, not the
source's domain-only ``classification`` column.

Run:
    scripts/populator/.venv/bin/python -m scripts.populator.tools.prepare_smag_inputs
"""
from __future__ import annotations

import argparse
import csv
import io
import pathlib
import sys
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from typing import Dict, List

_THIS = pathlib.Path(__file__).resolve()
REPO_ROOT = _THIS.parents[3]  # <repo>/scripts/populator/tools/prepare_smag_inputs.py
SMAG_DIR = REPO_ROOT / "scripts" / "populator" / "data" / "smag"
SAMPLE_METADATA_TSV = SMAG_DIR / "smag_sample_metadata.tsv"
GENOME_QC_TSV = SMAG_DIR / "smag_genome_qc.tsv"

SAMPLE_METADATA_URL = (
    "https://zenodo.org/records/8223844/files/"
    "Supplementary%20Data%201.xlsx?download=1")
GENOME_QC_URL = (
    "https://github.com/Caiyulu-818/SMAG/raw/main/Supplementary/"
    "Extended%20Data%20Table%202.xlsx")

# Output column -> source header name.
SAMPLE_COLUMNS: List[str] = [
    "user_genome", "latitude", "longitude", "ecosystem", "nation", "continent",
    "depth", "biosample", "bioproject", "source", "project",
]
SAMPLE_SOURCE = {c: c for c in SAMPLE_COLUMNS}
SAMPLE_SOURCE.update({
    "user_genome": "user_genome", "latitude": "Lat", "longitude": "Lon",
    "ecosystem": "Ecosystem", "nation": "Nation", "continent": "Continent",
    "depth": "Depth", "biosample": "Biosample", "bioproject": "Bioproject",
    "source": "Source", "project": "Project",
})

QC_COLUMNS: List[str] = [
    "user_genome", "completeness", "contamination", "length", "classification",
]
QC_SOURCE = {c: c for c in QC_COLUMNS}
QC_SOURCE["classification"] = "GTDB_pplacer_taxonomy"

# The committed files have 3,304 / 40,039 rows; fewer means a truncated fetch.
_MIN_SAMPLE_ROWS = 3000
_MIN_QC_ROWS = 39000


def _localname(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _col_index(cell_ref: str) -> int:
    """0-based column index from an A1-style cell reference (e.g. ``AB12`` -> 27)."""
    letters = "".join(ch for ch in cell_ref if ch.isalpha())
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch.upper()) - 64)
    return n - 1


def parse_xlsx_rows(data: bytes) -> List[List[str]]:
    """Parse the first worksheet of an XLSX into string rows, matching tags by local
    name. Missing cells are filled with ``""`` up to the row's max column.
    """
    z = zipfile.ZipFile(io.BytesIO(data))

    shared: List[str] = []
    if "xl/sharedStrings.xml" in z.namelist():
        sst = ET.fromstring(z.read("xl/sharedStrings.xml"))
        for si in sst:
            if _localname(si.tag) != "si":
                continue
            shared.append("".join(
                t.text or "" for t in si.iter() if _localname(t.tag) == "t"))

    sheet_names = [n for n in z.namelist()
                   if n.startswith("xl/worksheets/") and n.endswith(".xml")]
    if not sheet_names:
        raise ValueError("XLSX has no worksheet")
    root = ET.fromstring(z.read(sorted(sheet_names)[0]))

    rows: List[List[str]] = []
    for row in root.iter():
        if _localname(row.tag) != "row":
            continue
        cells: Dict[int, str] = {}
        max_col = -1
        for c in row:
            if _localname(c.tag) != "c":
                continue
            ref = c.attrib.get("r", "")
            ci = _col_index(ref) if ref else (max_col + 1)
            ctype = c.attrib.get("t")
            val = ""
            if ctype == "s":
                v = next((x for x in c if _localname(x.tag) == "v"), None)
                if v is not None and v.text is not None:
                    idx = int(v.text)
                    val = shared[idx] if 0 <= idx < len(shared) else ""
            elif ctype == "inlineStr":
                val = "".join(
                    x.text or "" for x in c.iter() if _localname(x.tag) == "t")
            else:
                v = next((x for x in c if _localname(x.tag) == "v"), None)
                val = v.text if (v is not None and v.text is not None) else ""
            cells[ci] = val
            max_col = max(max_col, ci)
        rows.append([cells.get(i, "") for i in range(max_col + 1)])
    return rows


def _find_header(rows: List[List[str]]) -> int:
    """Index of the first row containing ``user_genome`` (the sample workbook has a
    title row first)."""
    for i, row in enumerate(rows):
        if "user_genome" in row:
            return i
    raise ValueError("no 'user_genome' header row found in worksheet")


def project_rows(rows: List[List[str]], out_columns: List[str],
                 source_by_output: Dict[str, str], min_rows: int) -> List[List[str]]:
    """Project worksheet rows onto ``out_columns`` by source header name, sorted by
    ``user_genome``. Raises ``ValueError`` on a missing header or fewer than
    ``min_rows`` rows.
    """
    hi = _find_header(rows)
    header = rows[hi]
    idx = {name: i for i, name in enumerate(header)}
    missing = [source_by_output[c] for c in out_columns
               if source_by_output[c] not in idx]
    if missing:
        raise ValueError(
            f"unexpected SMAG response header: missing source column(s) {missing} "
            f"in {header[:16]}...")

    def cell(row, name):
        i = idx[name]
        return row[i] if i < len(row) else ""

    out: List[List[str]] = []
    for row in rows[hi + 1:]:
        if cell(row, "user_genome") == "":
            continue
        out.append([cell(row, source_by_output[c]) for c in out_columns])
    if len(out) < min_rows:
        raise ValueError(
            f"SMAG input parsed only {len(out)} rows (< sanity floor {min_rows}); "
            "refusing to overwrite the committed file")
    out.sort(key=lambda r: r[0])  # by user_genome
    return out


def fetch_bytes(url: str, timeout: int = 300) -> bytes:
    """Fetch a URL's raw bytes; the UA header keeps GitHub/Zenodo happy."""
    req = urllib.request.Request(url, headers={"User-Agent": "atlas-populator"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def _write_tsv(out_path, header, rows) -> int:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh, delimiter="\t", lineterminator="\n")
        w.writerow(header)
        w.writerows(rows)
    return len(rows)


def build_sample_rows(data: bytes) -> List[List[str]]:
    return project_rows(parse_xlsx_rows(data), SAMPLE_COLUMNS, SAMPLE_SOURCE,
                        _MIN_SAMPLE_ROWS)


def build_qc_rows(data: bytes) -> List[List[str]]:
    return project_rows(parse_xlsx_rows(data), QC_COLUMNS, QC_SOURCE, _MIN_QC_ROWS)


def main(argv=None) -> int:
    argparse.ArgumentParser(
        description="Prepare the SMAG backfill input TSVs.").parse_args(argv)

    try:
        sample_rows = build_sample_rows(fetch_bytes(SAMPLE_METADATA_URL))
        qc_rows = build_qc_rows(fetch_bytes(GENOME_QC_URL))
    except Exception as exc:  # noqa: BLE001 - surface any fetch/parse failure as exit 1
        print(f"ERROR: SMAG inputs not written (committed files left intact): {exc}",
              file=sys.stderr)
        return 1

    n_s = _write_tsv(SAMPLE_METADATA_TSV, SAMPLE_COLUMNS, sample_rows)
    n_q = _write_tsv(GENOME_QC_TSV, QC_COLUMNS, qc_rows)
    print(f"wrote {SAMPLE_METADATA_TSV} ({n_s} data rows)")
    print(f"wrote {GENOME_QC_TSV} ({n_q} data rows)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
