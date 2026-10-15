"""Microflora Danica (MFD) sample-metadata enrichment. No database access.

Barcode resolution differs per data source. The crosswalk is built from the same field
metadata, so a lookup miss in :func:`map_sample_fields` raises ``KeyError``: it means
data drift, never a normal "no match".

Inputs (do not regenerate here):
  * ``data/mfd/mfd_field_metadata.tsv``
  * ``data/mfd/mfd_lr_ena_assembly_map.tsv``
  * ``data/mfd/mfd_gold_envo_crosswalk.tsv``
"""
from __future__ import annotations

import csv
import json
import re
from pathlib import Path
from typing import Dict, Optional, Tuple

from ..ids import entity_id

REPO_ROOT = Path(__file__).resolve().parents[3]
MFD_DIR = REPO_ROOT / "scripts" / "populator" / "data" / "mfd"
FIELD_METADATA_PATH = MFD_DIR / "mfd_field_metadata.tsv"
ENA_MAP_PATH = MFD_DIR / "mfd_lr_ena_assembly_map.tsv"
CROSSWALK_PATH = MFD_DIR / "mfd_gold_envo_crosswalk.tsv"

SOURCE_UUID_TO_SLUG: Dict[str, str] = {
    "e05519ea-b3f0-5d54-b90e-bfd0b282ded2": "custom",
    "0a9a4724-f924-54d9-b5bb-553f962eda00": "mfd-sr",
    "dfcd709d-0911-5d74-9696-f148b86ab799": "mfd-lr",
}

# The MAG slugs double as the ``resolve_barcode`` slug.
MAG_COLLECTION_SLUGS = frozenset({"mfd-sr", "mfd-lr"})
CUSTOM_SOURCE_NAME = "custom_microflora_danica"

MFD_SOURCE_URL = "https://www.nature.com/articles/s41586-025-09794-2"

MFD_SOURCE_NAMES: Tuple[str, ...] = (
    "custom_microflora_danica",
    "Microflora Danica (long-read)",
    "Microflora Danica (short-read)",
)

# Nature abstract via Europe PMC (citation markers removed, N2O de-subscripted).
_MFD_ABSTRACT = (
    "Over the past 20 years, there have been considerable advances in revealing the "
    "microbiomes that underpin processes in natural and human-associated environments. "
    "Recent large-scale metagenome surveys have recorded the variety of microbial life "
    "in the oceans, in the human gut and on Earth, with compilations encompassing "
    "thousands of public datasets. However, despite their broad scope, these studies "
    "often lack functional information, and their sample locations are frequently "
    "sparsely distributed, limited in resolution or lacking metadata. Here we present "
    "Microflora Danica—an atlas of Danish environmental microbiomes encompassing "
    "10,683 shotgun metagenomes and 450 nearly full-length 16S and 18S rRNA datasets, "
    "linked to a five-level habitat classification scheme. We show that although "
    "human-disturbed habitats have high alpha diversity, species reoccur, revealing "
    "hidden homogeneity. This underlines the role of natural systems in maintaining "
    "total species (gamma) diversity and emphasizes the need for national baselines for "
    "tracking microbial responses to land-use and climate change. Consequently, we "
    "focused our dataset exploration on nitrifiers, a functional group closely linked "
    "to climate change and of major importance for Denmark's primary land use: "
    "agriculture. We identify several lineages encoding nitrifier key genes and reveal "
    "the effects of land disturbance on the abundance of well-studied, as well as "
    "uncharacterized, nitrifier groups, with potential implications for N2O emissions. "
    "Microflora Danica offers an unparalleled resource for addressing fundamental "
    "questions in microbial ecology about what drives microbial diversity, distribution "
    "and function."
)

_MFD_AUTHORS = (
    "Singleton CM, Jensen TBN, Delogu F, Knudsen KS, Sørensen EA, Jørgensen VR, "
    "Karst SM, Yang Y, Sereika M, Petriglieri F, Knutsson S, Dall SM, Kirkegaard RH, "
    "Kristensen JM, Overgaard CK, Woodcroft BJ, Speth DR, Aroney STN, "
    "Microflora Danica Consortium, Wagner M, Dueholm MKD, Nielsen PH, Albertsen M"
)


def _mfd_metadata(sequencing: str, cross_bioproject: str, first_public: str) -> dict:
    return {
        "doi": "10.1038/s41586-025-09794-2",
        "preprint_doi": "10.1101/2024.06.27.600767",
        "journal": "Nature",
        "year": 2026,
        "volume": "649",
        "pages": "971-981",
        "publication_url": MFD_SOURCE_URL,
        "zenodo": ["10.5281/zenodo.17162544", "10.5281/zenodo.12605769"],
        "metadata_repo": "https://github.com/cmc-aau/mfd_metadata",
        "sequencing": sequencing,
        "cross_bioproject": cross_bioproject,
        "first_public": first_public,
        "authors": _MFD_AUTHORS,
    }


def _ds_ids(*names: str) -> list:
    return [str(entity_id("data_sources", name)) for name in names]


# Keyed on the unscoped bioproject, so custom and long-read deposits share one study.
# data_source_ids is set here; no per-unit provenance tags these studies.
_MFD_STUDIES: Dict[str, dict] = {
    "PRJEB58634": {
        "external_id": "PRJEB58634",
        "accession": "PRJEB58634",
        "bioproject": "PRJEB58634",
        "secondary_accession": "ERP143702",
        "study_name": "Microflora Danica (long-read)",
        "title": "The Microflora Danica atlas of Danish environmental microbiomes",
        "abstract": _MFD_ABSTRACT,
        "study_type": "metagenomics",
        "center_name": "Center for Microbial Communities, Aalborg University",
        "data_source_ids": _ds_ids("custom_microflora_danica",
                                   "Microflora Danica (long-read)"),
        "metadata": json.dumps(
            _mfd_metadata("Nanopore long-read", "PRJNA1071982", "2024-12-25"),
            separators=(",", ":")),
    },
    "PRJNA1071982": {
        "external_id": "PRJNA1071982",
        "accession": "PRJNA1071982",
        "bioproject": "PRJNA1071982",
        "secondary_accession": "SRP489326",
        "study_name": "Microflora Danica (short-read)",
        "title": "The Microflora Danica atlas of Danish environmental microbiomes",
        "abstract": _MFD_ABSTRACT,
        "study_type": "metagenomics",
        "center_name": "Center for Microbial Communities, Aalborg University",
        "data_source_ids": _ds_ids("Microflora Danica (short-read)"),
        "metadata": json.dumps(
            _mfd_metadata("Illumina short-read", "PRJEB58634", "2024-06-29"),
            separators=(",", ":")),
    },
}

_MFD_SLUG_TO_BIOPROJECT: Dict[str, str] = {
    "custom": "PRJEB58634",
    "mfd-lr": "PRJEB58634",
    "mfd-sr": "PRJNA1071982",
}


def mfd_study(slug: str) -> Optional[Tuple[str, dict]]:
    """``(bioproject_nk, study_payload)``, or None for a non-MFD slug. The nk is shared by
    the emit path and the backfill; the payload is a fresh copy per call."""
    bioproject = _MFD_SLUG_TO_BIOPROJECT.get(slug)
    if bioproject is None:
        return None
    return bioproject, dict(_MFD_STUDIES[bioproject])

FIELD_COLUMNS: Tuple[str, ...] = (
    "fieldsample_barcode", "project_id", "sampling_date", "latitude", "longitude",
    "sitename", "coords_reliable", "mfd_sampletype", "mfd_areatype", "mfd_hab1",
    "mfd_hab2", "mfd_hab3", "habitat_typenumber",
)

_CROSSWALK_VALUE_COLUMNS: Tuple[str, ...] = (
    "gold_ecosystem_path", "environment_biome", "environment_feature",
    "environment_material", "environmental_package",
)

_BARCODE_RE = re.compile(r"^MFD\d+$")

_LOCATION_RESOLUTION = {
    "Masked": "masked",
    "No": "unreliable",
    "Yes": "point",
    "": None,
}


def resolve_barcode(accession: str, slug: str, ena_map: Dict[str, str]) -> Optional[str]:
    """custom: the accession is the barcode; mfd-sr: strip the `_ilm` bin suffix (drops
    ``unknown_ilm_asm_binN``); mfd-lr: look up ``ena_map``.
    """
    if slug == "custom":
        return accession if _BARCODE_RE.match(accession) else None
    if slug == "mfd-sr":
        barcode = accession.split("_ilm")[0]
        return barcode if _BARCODE_RE.match(barcode) else None
    if slug == "mfd-lr":
        return ena_map.get(accession)
    raise ValueError(f"unknown MFD source slug: {slug!r}")


_ENA_COLUMNS: Tuple[str, ...] = ("accession", "assembly_name", "barcode")
_CROSSWALK_KEY_COLUMNS: Tuple[str, ...] = (
    "mfd_sampletype", "mfd_areatype", "mfd_hab1", "mfd_hab2", "mfd_hab3",
)


def _read_named_rows(path: Path, required_columns: Tuple[str, ...]):
    """Map cells by header name, not position, so a reordered writer can't transpose values."""
    with open(path, newline="", encoding="utf-8") as fh:
        reader = csv.reader(fh, delimiter="\t")
        header = next(reader)
        idx = {name: i for i, name in enumerate(header)}
        missing = [c for c in required_columns if c not in idx]
        if missing:
            raise ValueError(
                f"{path.name}: header missing column(s) {missing}; got header {header}"
            )
        for row in reader:
            if not row:
                continue
            if len(row) != len(header):
                raise ValueError(
                    f"{path.name}: ragged row has {len(row)} cells, expected "
                    f"{len(header)}: {row}"
                )
            yield {name: row[i] for name, i in idx.items()}


def load_ena_map(path: Path = ENA_MAP_PATH) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for record in _read_named_rows(path, _ENA_COLUMNS):
        accession, barcode = record["accession"], record["barcode"]
        prev = out.get(accession)
        if prev is not None and prev != barcode:
            raise ValueError(
                f"ENA map: accession {accession!r} maps to two barcodes "
                f"({prev!r} and {barcode!r})"
            )
        out[accession] = barcode
    return out


def load_field_metadata(path: Path = FIELD_METADATA_PATH) -> Dict[str, dict]:
    out: Dict[str, dict] = {}
    for record in _read_named_rows(path, FIELD_COLUMNS):
        record = {c: record[c] for c in FIELD_COLUMNS}
        barcode = record["fieldsample_barcode"]
        if barcode in out:
            raise ValueError(f"field metadata: duplicate barcode {barcode!r}")
        out[barcode] = record
    return out


def load_crosswalk(path: Path = CROSSWALK_PATH) -> Dict[Tuple[str, str, str, str, str], dict]:
    """Keys keep empty strings so they match a field row verbatim."""
    required = _CROSSWALK_KEY_COLUMNS + _CROSSWALK_VALUE_COLUMNS
    out: Dict[Tuple[str, str, str, str, str], dict] = {}
    for record in _read_named_rows(path, required):
        key = tuple(record[c] for c in _CROSSWALK_KEY_COLUMNS)
        if key in out:
            raise ValueError(f"crosswalk: duplicate 5-tuple key {key!r}")
        out[key] = {c: record[c] for c in _CROSSWALK_VALUE_COLUMNS}
    return out


def _none_if_empty(value: str) -> Optional[str]:
    return value if value != "" else None


def map_sample_fields(meta_row: dict, crosswalk: Dict[Tuple[str, str, str, str, str], dict]) -> dict:
    lat = meta_row["latitude"]
    lon = meta_row["longitude"]

    key = (
        meta_row["mfd_sampletype"], meta_row["mfd_areatype"], meta_row["mfd_hab1"],
        meta_row["mfd_hab2"], meta_row["mfd_hab3"],
    )
    cw = crosswalk[key]  # a miss means data drift

    out: Dict[str, object] = {
        "latitude": float(lat) if lat != "" else None,
        "longitude": float(lon) if lon != "" else None,
        "location_resolution": _LOCATION_RESOLUTION[meta_row["coords_reliable"]],
        "collection_date": _none_if_empty(meta_row["sampling_date"]),
        "geolocation_name": _none_if_empty(meta_row["sitename"]),
        "geographic_location": "Denmark",
    }
    for col in _CROSSWALK_VALUE_COLUMNS:
        out[col] = _none_if_empty(cw[col])

    mfd_meta_fields = [
        ("barcode", meta_row["fieldsample_barcode"]),
        ("project_id", meta_row["project_id"]),
        ("sampletype", meta_row["mfd_sampletype"]),
        ("areatype", meta_row["mfd_areatype"]),
        ("hab1", meta_row["mfd_hab1"]),
        ("hab2", meta_row["mfd_hab2"]),
        ("hab3", meta_row["mfd_hab3"]),
        ("habitat_typenumber", meta_row["habitat_typenumber"]),
    ]
    mfd_inner = {k: v for k, v in mfd_meta_fields if v != ""}
    out["metadata"] = json.dumps({"mfd": mfd_inner}, separators=(",", ":"))

    return out


# Loaded once per emit run.
_LOADED: Optional[Tuple[Dict[str, dict], Dict[str, str], dict]] = None


def _loaded() -> Tuple[Dict[str, dict], Dict[str, str], dict]:
    global _LOADED
    if _LOADED is None:
        _LOADED = (load_field_metadata(), load_ena_map(), load_crosswalk())
    return _LOADED


def enrichment_for(accession: str, slug: str) -> Optional[dict]:
    """None when the genome does not resolve to an MFD field sample, so the caller emits
    its minimal record."""
    field, ena_map, crosswalk = _loaded()
    barcode = resolve_barcode(accession, slug, ena_map)
    if barcode is None:
        return None
    meta_row = field.get(barcode)
    if meta_row is None:
        return None
    return map_sample_fields(meta_row, crosswalk)
