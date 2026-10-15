"""Prepare (best-effort reproducer) the two committed TSV inputs for the GTDB ecosystem
backfill, under ``data/gtdb/``:

  * ``gold_biosample_ecosystem.tsv`` (``ncbi_biosample`` -> ``gold_ecosystem_path``),
    streamed from ``docs/goldData.xlsx``; the organism ecosystem wins over the
    biosample ecosystem. The committed file is filtered to the GTDB biosamples, which
    needs ``--biosample-filter``; without it the full GOLD map is written.

  * ``madin_species_traits.tsv``: the bacteria-archaea-traits per-species table,
    species lowercased.

Both refuse to overwrite the committed file from a suspiciously small parse.

Run:
    scripts/populator/.venv/bin/python -m scripts.populator.tools.prepare_gtdb_ecosystem_inputs
      [--gold-xlsx docs/goldData.xlsx] [--biosample-filter gtdb_biosamples.txt]
      [--skip-gold] [--skip-madin]
"""
from __future__ import annotations

import argparse
import csv
import pathlib
import sys
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

_THIS = pathlib.Path(__file__).resolve()
REPO_ROOT = _THIS.parents[3]  # <repo>/scripts/populator/tools/prepare_gtdb_ecosystem_inputs.py
GTDB_DIR = REPO_ROOT / "scripts" / "populator" / "data" / "gtdb"
GOLD_TSV = GTDB_DIR / "gold_biosample_ecosystem.tsv"
MADIN_TSV = GTDB_DIR / "madin_species_traits.tsv"
DEFAULT_GOLD_XLSX = REPO_ROOT / "docs" / "goldData.xlsx"

MADIN_URL = ("https://raw.githubusercontent.com/bacteria-archaea-traits/"
             "bacteria-archaea-traits/master/output/condensed_species_GTDB.csv")
# Identity map to the source columns; species is lowercased.
MADIN_COLUMNS = ("species", "isolation_source", "optimum_ph", "optimum_tmp", "metabolism",
                 "gram_stain", "range_salinity", "cell_shape")
GOLD_COLUMNS = ("ncbi_biosample", "gold_ecosystem_path")

_MIN_MADIN_ROWS = 5000
_MIN_GOLD_ROWS = 50000

_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def _strip(tag: str) -> str:
    return tag.split("}")[-1]


def _col_letter(ref: str) -> str:
    import re
    m = re.match(r"[A-Z]+", ref or "")
    return m.group() if m else ""


def _stream_rows(zf: zipfile.ZipFile, member: str, wantcols):
    """Stream an xlsx worksheet as ``{col_letter: text}`` for ``wantcols`` only,
    clearing elements so a multi-GB sheet stays O(1) in memory."""
    wantcols = set(wantcols)
    with zf.open(member) as fh:
        rowd, curcol, buf, keep = {}, None, [], False
        for ev, el in ET.iterparse(fh, events=("start", "end")):
            tag = _strip(el.tag)
            if ev == "start" and tag == "c":
                curcol = _col_letter(el.get("r", ""))
                buf = []
                keep = curcol in wantcols
            elif ev == "end" and tag == "t":
                if keep:
                    buf.append(el.text or "")
            elif ev == "end" and tag == "v":
                if keep and not buf:
                    buf.append(el.text or "")
            elif ev == "end" and tag == "c":
                if keep:
                    rowd[curcol] = "".join(buf)
            elif ev == "end" and tag == "row":
                yield rowd
                rowd = {}
            if ev == "end":
                el.clear()


def _mkpath(levels) -> str:
    """Join ecosystem levels with ':', dropping trailing empty/Unclassified ones."""
    lv = [(x or "").strip() for x in levels]
    while lv and (lv[-1] == "" or lv[-1].lower() == "unclassified"):
        lv.pop()
    return ":".join(lv) if lv else ""


def build_gold_biosample_map(xlsx_path: pathlib.Path) -> dict:
    """Stream ``goldData.xlsx`` and return ``{ncbi_biosample: gold_ecosystem_path}``.

    Organism sheet4 (A=org_gold_id, AA..AE ecosystem); Biosample sheet3 (A=bs_gold_id, K..O
    ecosystem); Sequencing Project sheet5 (I=ncbi_biosample, S=org_gold_id, T=bs_gold_id).
    """
    z = zipfile.ZipFile(xlsx_path)

    org_path = {}
    first = True
    for r in _stream_rows(z, "xl/worksheets/sheet4.xml", {"A", "AA", "AB", "AC", "AD", "AE"}):
        if first:
            first = False
            continue
        oid = r.get("A", "")
        if not oid:
            continue
        p = _mkpath([r.get("AA"), r.get("AB"), r.get("AC"), r.get("AD"), r.get("AE")])
        if p:
            org_path[oid] = p

    bs_path = {}
    first = True
    for r in _stream_rows(z, "xl/worksheets/sheet3.xml", {"A", "K", "L", "M", "N", "O"}):
        if first:
            first = False
            continue
        bid = r.get("A", "")
        if not bid:
            continue
        p = _mkpath([r.get("K"), r.get("L"), r.get("M"), r.get("N"), r.get("O")])
        if p:
            bs_path[bid] = p

    acc_path = {}
    first = True
    for r in _stream_rows(z, "xl/worksheets/sheet5.xml", {"I", "S", "T"}):
        if first:
            first = False
            continue
        acc = (r.get("I", "") or "").strip()
        if not acc:
            continue
        p = org_path.get(r.get("S", "")) or bs_path.get(r.get("T", ""))
        if not p:
            continue
        for a in acc.split("|"):
            a = a.strip()
            if a:
                acc_path[a] = p
    return acc_path


def parse_madin_csv(text: str, min_rows: int = _MIN_MADIN_ROWS) -> list:
    """Parse the bacteria-archaea-traits CSV into ``MADIN_COLUMNS``-ordered rows sorted
    by lowercased species. Raises ``ValueError`` on a missing column or too few rows."""
    reader = csv.reader(text.splitlines())
    try:
        header = next(reader)
    except StopIteration:
        raise ValueError("empty Madin response")
    idx = {name: i for i, name in enumerate(header)}
    missing = [c for c in MADIN_COLUMNS if c not in idx]
    if missing:
        raise ValueError(f"unexpected Madin CSV header: missing column(s) {missing}")
    out = []
    for cells in reader:
        if not cells:
            continue
        row = []
        for col in MADIN_COLUMNS:
            i = idx[col]
            value = cells[i] if i < len(cells) else ""
            if col == "species":
                value = value.strip().lower()
            row.append(value)
        if row[0]:  # require a species
            out.append(row)
    if len(out) < min_rows:
        raise ValueError(
            f"Madin CSV parsed only {len(out)} rows (< sanity floor {min_rows}); "
            "refusing to overwrite the committed file")
    out.sort(key=lambda r: r[0])
    return out


def _write_tsv(out_path: pathlib.Path, header, rows) -> int:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh, delimiter="\t", lineterminator="\n")
        w.writerow(header)
        w.writerows(rows)
    return len(rows)


def _load_filter(path: pathlib.Path) -> set:
    return {l.strip() for l in open(path, encoding="utf-8") if l.strip()}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        description="Prepare the GTDB ecosystem backfill input TSVs (best-effort).")
    ap.add_argument("--gold-xlsx", type=pathlib.Path, default=DEFAULT_GOLD_XLSX)
    ap.add_argument("--biosample-filter", type=pathlib.Path, default=None,
                    help="restrict the GOLD map to these ncbi_biosamples (one per line); "
                         "the committed file is filtered to the GTDB biosample set")
    ap.add_argument("--skip-gold", action="store_true")
    ap.add_argument("--skip-madin", action="store_true")
    args = ap.parse_args(argv)

    rc = 0

    if not args.skip_gold:
        try:
            acc_path = build_gold_biosample_map(args.gold_xlsx)
            if args.biosample_filter is not None:
                keep = _load_filter(args.biosample_filter)
                acc_path = {a: p for a, p in acc_path.items() if a in keep}
            if len(acc_path) < _MIN_GOLD_ROWS:
                raise ValueError(
                    f"GOLD map has only {len(acc_path)} biosamples (< floor {_MIN_GOLD_ROWS}); "
                    "refusing to overwrite the committed file")
            rows = sorted(acc_path.items())
            n = _write_tsv(GOLD_TSV, GOLD_COLUMNS, rows)
            note = "" if args.biosample_filter else "  (UNFILTERED superset -- no --biosample-filter)"
            print(f"wrote {GOLD_TSV} ({n} rows){note}")
        except Exception as exc:  # noqa: BLE001
            print(f"ERROR: GOLD map not written (committed file left intact): {exc}",
                  file=sys.stderr)
            rc = 1

    if not args.skip_madin:
        try:
            with urllib.request.urlopen(MADIN_URL, timeout=300) as resp:
                text = resp.read().decode("utf-8", errors="replace")
            rows = parse_madin_csv(text)
            n = _write_tsv(MADIN_TSV, MADIN_COLUMNS, rows)
            print(f"wrote {MADIN_TSV} ({n} rows)")
        except Exception as exc:  # noqa: BLE001
            print(f"ERROR: Madin traits not written (committed file left intact): {exc}",
                  file=sys.stderr)
            rc = 1

    return rc


if __name__ == "__main__":
    sys.exit(main())
