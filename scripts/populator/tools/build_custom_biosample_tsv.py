#!/usr/bin/env python3
"""Build a custom dataset's per-sample metadata TSV from ENA BioSample XML.

For custom datasets whose samples are public ENA BioSamples (e.g. the Great Barrier Reef and
Helgoland 2020 long-read assemblies). The output goes under scripts/populator/data/customs/ and is
read by adapters/customs_metadata.py, joined on the assembly accession (the archive alias).

Values are copied, never inferred: an attribute the BioSample does not carry stays empty, and so
does one that cannot be read exactly -- a coordinate or depth that is not a plain number, a depth
not in metres, a date range, an INSDC missing-value term ("missing: not provided"). The per-column
empty counts are printed. ENVO terms keep their label and drop the id ("marine biome
[ENVO:00000447]" -> "marine biome"). `platform` is NOT from the BioSample: it is the load request's
column (from the ENA run/assembly records).

Input: the load-request TSV (study, assembly, biosample, source_file, platform, archive) and a dir
of <BioSample>.xml files (ENA SAMPLE_SET XML).

Usage:
    python -m scripts.populator.tools.build_custom_biosample_tsv --request <tsv> --study PRJEB52999 \\
        --xml-dir <dir> --out scripts/populator/data/customs/helgoland_2020_sample_metadata.tsv
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

COLUMNS = ("assembly", "biosample", "title", "latitude", "longitude", "collection_date", "depth_m",
           "country", "environment_biome", "environment_feature", "environment_material", "platform",
           "project_name", "extra")
# first attribute present wins
TAGS = {
    "latitude": ("geographic location (latitude)",),
    "longitude": ("geographic location (longitude)",),
    "collection_date": ("collection date",),
    "depth": ("geographic location (depth)", "depth"),
    "country": ("geographic location (country and/or sea)",),
    "environment_biome": ("environment (biome)", "broad-scale environmental context"),
    "environment_feature": ("environment (feature)",),
    "environment_material": ("environment (material)", "environmental medium"),
    "project_name": ("project name",),
}
# dataset-specific attributes kept verbatim in `extra` (sample metadata JSON)
EXTRA_TAGS = ("Reef sector", "GBR sector", "Station Name", "Reef zoning", "sample composed of",
              "sample collection method", "local environmental context")
_ENVO_ID = re.compile(r"\s*[\[(]ENVO:\d+[\])]\s*$")
_NUM = re.compile(r"-?\d+(?:\.\d+)?")
_DATE = re.compile(r"(\d{4}-\d{2}-\d{2})(?:T[\d:.]+Z?)?")
_METRES = {"", "m", "meter", "meters", "metre", "metres"}
_DEGREES = {"", "dd", "decimal degrees", "degrees"}


def missing(value: str) -> bool:
    """INSDC missing-value terms ("missing: not provided", "not collected", "not applicable", ...)."""
    v = value.strip().lower()
    return not v or v.startswith("missing") or v in {"not collected", "not provided", "not applicable",
                                                     "restricted access", "unknown", "na", "n/a"}


def attributes(xml_path: Path) -> tuple[dict, dict, str]:
    """(value by tag, unit by tag, title). A repeated tag keeps its first value."""
    root = ET.parse(xml_path).getroot()
    attrs, units = {}, {}
    for a in root.iter("SAMPLE_ATTRIBUTE"):
        tag, value = (a.findtext("TAG") or "").strip(), (a.findtext("VALUE") or "").strip()
        if tag and not missing(value) and tag not in attrs:
            attrs[tag] = value
            units[tag] = (a.findtext("UNITS") or "").strip()
    title = (root.findtext(".//TITLE") or "").strip()
    return attrs, units, title


def first_tag(attrs: dict, key: str) -> str:
    return next((tag for tag in TAGS[key] if attrs.get(tag)), "")


def first(attrs: dict, key: str) -> str:
    tag = first_tag(attrs, key)
    return attrs[tag] if tag else ""


def number(value: str, unit: str = "", allowed=None) -> str:
    """A plain signed number, else "" (no '11.35 S', no '0-5', no '1e2'); "" if the unit is not allowed."""
    value = (value or "").strip()
    if not _NUM.fullmatch(value):
        return ""
    if allowed is not None and unit.strip().lower() not in allowed:
        return ""
    return value


def row_for(assembly: str, biosample: str, platform: str, attrs: dict, title: str, units=None) -> dict:
    units = units or {}
    m = _DATE.fullmatch(first(attrs, "collection_date"))
    date = m.group(1) if m else ""          # a range or partial date stays empty
    extra = {t: attrs[t] for t in EXTRA_TAGS if attrs.get(t)}
    return {
        "assembly": assembly, "biosample": biosample, "title": title,
        "latitude": number(first(attrs, "latitude"), units.get(first_tag(attrs, "latitude"), ""), _DEGREES),
        "longitude": number(first(attrs, "longitude"), units.get(first_tag(attrs, "longitude"), ""), _DEGREES),
        "collection_date": date,
        "depth_m": number(first(attrs, "depth"), units.get(first_tag(attrs, "depth"), ""), _METRES),
        "country": first(attrs, "country"),
        "environment_biome": _ENVO_ID.sub("", first(attrs, "environment_biome")),
        "environment_feature": _ENVO_ID.sub("", first(attrs, "environment_feature")),
        "environment_material": _ENVO_ID.sub("", first(attrs, "environment_material")),
        "platform": platform, "project_name": first(attrs, "project_name"),
        "extra": json.dumps(extra, separators=(",", ":"), ensure_ascii=False) if extra else "",
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--request", required=True)
    ap.add_argument("--study", required=True)
    ap.add_argument("--xml-dir", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    with open(a.request, newline="") as fh:
        rows = [r for r in csv.DictReader(fh, delimiter="\t") if r["study"] == a.study]
    if not rows:
        sys.exit(f"no rows for {a.study} in {a.request}")
    out = []
    for r in sorted(rows, key=lambda r: r["assembly"]):
        xml = Path(a.xml_dir) / f"{r['biosample']}.xml"
        if not xml.exists():
            sys.exit(f"missing {xml}")
        attrs, units, title = attributes(xml)
        out.append(row_for(r["assembly"], r["biosample"], r["platform"], attrs, title, units))
    with open(a.out, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=COLUMNS, delimiter="\t", lineterminator="\n")
        w.writeheader()
        w.writerows(out)
    empty = {c: sum(1 for o in out if not o[c]) for c in COLUMNS if c != "extra"}
    print(f"wrote {len(out)} rows -> {a.out}; empty per column: "
          + ", ".join(f"{c} {n}" for c, n in empty.items() if n))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
