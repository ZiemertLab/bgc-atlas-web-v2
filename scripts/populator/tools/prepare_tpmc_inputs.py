"""Prepare the committed TSV input for the TPMC (Tibetan Plateau Microbial Catalog)
sample-metadata backfill -- a best-effort reproducer.

Writes ``data/tpmc/tpmc_sample_metadata.tsv`` (27 per-sample columns) from the TPMC
portal's metadata workbook. Stdlib only.

Source headers are messy, so each output column is matched by normalized comparison
(lowercase, ``[a-z0-9]`` only) against candidate spellings. Verbatim anchors:

    'Temperature (Temp, ℃)'                         -> temperature_c   (temperaturetempc)
    'Salt concentration (Sal, PSU)'                 -> salinity_psu    (saltconcentrationsalpsu)
    'NO22- (mg/L)'                                  -> no2_mg_l        (no22mgl)
    'Dissolved inorganic phosphorus (DIP, mg/L)'    -> dip_mg_l        (dissolvedinorganicphosphorusdipmgl)

Run:
    scripts/populator/.venv/bin/python -m scripts.populator.tools.prepare_tpmc_inputs
"""
from __future__ import annotations

import argparse
import csv
import io
import pathlib
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from typing import Dict, List

_THIS = pathlib.Path(__file__).resolve()
REPO_ROOT = _THIS.parents[3]  # <repo>/scripts/populator/tools/prepare_tpmc_inputs.py
TPMC_DIR = REPO_ROOT / "scripts" / "populator" / "data" / "tpmc"
SAMPLE_METADATA_TSV = TPMC_DIR / "tpmc_sample_metadata.tsv"

METADATA_URL = "https://download.cncb.ac.cn/bigd/TPMC/meta_table.xlsx"

SAMPLE_COLUMNS: List[str] = [
    "sample_id", "biosample", "location", "region", "biome", "latitude", "longitude",
    "altitude", "depth_m", "ph", "temperature_c", "salinity_psu", "do_mg_l", "do_pct",
    "no3_mg_l", "no2_mg_l", "nh4_mg_l", "dip_mg_l", "tp_mg_l", "tn_mg_l", "toc_mg_l",
    "turbidity_ntu", "tds_mg_l", "chlorophyll_ug_l", "cl_mg_l", "so4_mg_l", "na_mg_l",
]

# Output column -> candidate normalized source-header spellings, anchors first.
SOURCE_CANDIDATES: Dict[str, List[str]] = {
    "sample_id":        ["sampleid", "sample", "samplename", "id"],
    "biosample":        ["biosample", "biosampleaccession", "biosampleid", "biosampleacc"],
    "location":         ["location", "site", "samplingsite", "samplinglocation"],
    "region":           ["region", "province", "area"],
    "biome":            ["biome", "habitat", "habitattype", "ecosystem", "watertype", "type"],
    "latitude":         ["latitude", "lat"],
    "longitude":        ["longitude", "lon", "lng", "long"],
    "altitude":         ["altitude", "altitudem", "elevation", "elevationm", "altm"],
    "depth_m":          ["depthm", "depth", "waterdepth", "waterdepthm", "samplingdepth"],
    "ph":               ["ph"],
    # '℃' (U+2103) normalizes to nothing but '°C' to 'c', so accept both forms.
    "temperature_c":    ["temperaturetempc", "temperaturetemp", "temperaturec",
                         "temperature", "temp", "tempc", "watertemperature"],
    "salinity_psu":     ["saltconcentrationsalpsu", "salinitypsu", "salinity", "sal",
                         "saltconcentration"],
    "do_mg_l":          ["domgl", "dissolvedoxygenmgl", "dissolvedoxygen", "do"],
    "do_pct":           ["dopct", "dopercent", "dosat", "dosaturation",
                         "dissolvedoxygensaturation"],
    "no3_mg_l":         ["no3mgl", "no3", "nitrate", "nitratemgl", "no3nmgl"],
    "no2_mg_l":         ["no22mgl", "no2mgl", "no2", "nitrite", "nitritemgl"],
    "nh4_mg_l":         ["nh4mgl", "nh4", "ammonium", "ammoniummgl", "nh4nmgl"],
    "dip_mg_l":         ["dissolvedinorganicphosphorusdipmgl", "dipmgl", "dip",
                         "dissolvedinorganicphosphorus"],
    "tp_mg_l":          ["tpmgl", "tp", "totalphosphorus", "totalphosphorusmgl"],
    "tn_mg_l":          ["tnmgl", "tn", "totalnitrogen", "totalnitrogenmgl"],
    "toc_mg_l":         ["tocmgl", "toc", "totalorganiccarbon", "totalorganiccarbonmgl"],
    "turbidity_ntu":    ["turbidityntu", "turbidity", "turb", "turbntu"],
    "tds_mg_l":         ["tdsmgl", "tds", "totaldissolvedsolids", "totaldissolvedsolidsmgl"],
    "chlorophyll_ug_l": ["chlorophyllugl", "chlorophyllaugl", "chlorophyll", "chlorophylla",
                         "chla", "chl"],
    "cl_mg_l":          ["clmgl", "cl", "chloride", "chloridemgl"],
    "so4_mg_l":         ["so4mgl", "so42mgl", "so4", "sulfate", "sulfatemgl", "sulphate"],
    "na_mg_l":          ["namgl", "na", "sodium", "sodiummgl"],
}

# The committed file has NA already stripped to empty.
_MISSING = {"", "na", "n/a", "nan", "null", "none", "-"}

# The committed file has 498 rows; fewer means a truncated fetch.
_MIN_ROWS = 400


def _localname(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _col_index(cell_ref: str) -> int:
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


def _norm(header: str) -> str:
    """Lowercase and keep only [a-z0-9] (drops units and symbols like ``℃`` / ``µ``)."""
    return re.sub(r"[^a-z0-9]", "", (header or "").lower())


def _strip_missing(cell: str) -> str:
    return "" if cell.strip().lower() in _MISSING else cell


def _find_header_row(rows: List[List[str]]) -> int:
    """First row that matches both a sample_id and a latitude candidate (skips a title row)."""
    want_id = set(SOURCE_CANDIDATES["sample_id"])
    want_lat = set(SOURCE_CANDIDATES["latitude"])
    for i, row in enumerate(rows):
        norms = {_norm(c) for c in row}
        if norms & want_id and norms & want_lat:
            return i
    raise ValueError("no TPMC header row found (needs a sample_id + latitude column)")


def project_rows(rows: List[List[str]]) -> List[List[str]]:
    """Project worksheet rows onto :data:`SAMPLE_COLUMNS`, sorted by ``sample_id``.
    Raises ``ValueError`` on an unmatched header or fewer than :data:`_MIN_ROWS` rows."""
    hi = _find_header_row(rows)
    header = rows[hi]
    norm_to_idx: Dict[str, int] = {}
    for i, name in enumerate(header):
        norm_to_idx.setdefault(_norm(name), i)

    col_idx: Dict[str, int] = {}
    missing: List[str] = []
    for out in SAMPLE_COLUMNS:
        idx = next((norm_to_idx[c] for c in SOURCE_CANDIDATES[out] if c in norm_to_idx),
                   None)
        if idx is None:
            missing.append(out)
        else:
            col_idx[out] = idx
    if missing:
        raise ValueError(
            f"unexpected TPMC response header: could not match output column(s) {missing} "
            f"in {header[:32]}...")

    def cell(row, out):
        i = col_idx[out]
        return _strip_missing(row[i] if i < len(row) else "")

    out_rows: List[List[str]] = []
    for row in rows[hi + 1:]:
        if cell(row, "sample_id") == "":
            continue
        out_rows.append([cell(row, out) for out in SAMPLE_COLUMNS])
    if len(out_rows) < _MIN_ROWS:
        raise ValueError(
            f"TPMC input parsed only {len(out_rows)} rows (< sanity floor {_MIN_ROWS}); "
            "refusing to overwrite the committed file")
    out_rows.sort(key=lambda r: r[0])  # by sample_id
    return out_rows


def fetch_bytes(url: str, timeout: int = 300) -> bytes:
    """Fetch a URL's raw bytes; the UA header keeps the server happy."""
    req = urllib.request.Request(url, headers={"User-Agent": "atlas-populator"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def build_sample_rows(data: bytes) -> List[List[str]]:
    return project_rows(parse_xlsx_rows(data))


def _write_tsv(out_path, header, rows) -> int:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh, delimiter="\t", lineterminator="\n")
        w.writerow(header)
        w.writerows(rows)
    return len(rows)


def main(argv=None) -> int:
    argparse.ArgumentParser(
        description="Prepare the TPMC backfill input TSV (best-effort).").parse_args(argv)

    try:
        sample_rows = build_sample_rows(fetch_bytes(METADATA_URL))
    except Exception as exc:  # noqa: BLE001 - surface any fetch/parse failure as exit 1
        print(f"ERROR: TPMC input not written (committed file left intact): {exc}",
              file=sys.stderr)
        return 1

    n = _write_tsv(SAMPLE_METADATA_TSV, SAMPLE_COLUMNS, sample_rows)
    print(f"wrote {SAMPLE_METADATA_TSV} ({n} data rows)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
