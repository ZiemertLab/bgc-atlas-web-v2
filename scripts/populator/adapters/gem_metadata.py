"""GEM (Genomes from Earth's Microbiomes) sample-metadata enrichment. No database access.

``samples.accession`` is the GEM ``genome_id``, so lookup needs no resolution.
Input: ``data/gem/gem_genome_metadata.tsv`` (regenerate with ``tools/prepare_gem_inputs.py``).
"""
from __future__ import annotations

import csv
import json
import math
from pathlib import Path
from typing import Dict, Optional, Tuple

GEM_SOURCE_UUID = "9eedc1b2-5007-5481-a684-550f9b3892f7"
GEM_COLLECTION_SLUG = "gem"

# IMG ecosystem_category -> GOLD top-level domain; an absent category yields no path.
GEM_CATEGORY_TO_ECOSYSTEM: Dict[str, str] = {
    "Aquatic": "Environmental",
    "Human": "Host-associated",
    "Terrestrial": "Environmental",
    "Built environment": "Engineered",
    "Wastewater": "Engineered",
    "Mammals": "Host-associated",
    "Plants": "Host-associated",
    "Bioreactor": "Engineered",
    "Lab enrichment": "Engineered",
    "Arthropoda": "Host-associated",
    "Solid waste": "Engineered",
    "Animal": "Host-associated",
    "Fungi": "Host-associated",
    "Biotransformation": "Engineered",
    "Insecta": "Host-associated",
    "Algae": "Host-associated",
    "Bioremediation": "Engineered",
    "Modeled": "Engineered",
    "Porifera": "Host-associated",
    "Annelida": "Host-associated",
    "Birds": "Host-associated",
    "Microbial": "Host-associated",
    "Cnidaria": "Host-associated",
    "Air": "Environmental",
    "Industrial production": "Engineered",
    "Lab synthesis": "Engineered",
    "Mollusca": "Host-associated",
    "Fish": "Host-associated",
    "Tunicates": "Host-associated",
    "Invertebrates": "Host-associated",
}

# Lowercase to satisfy the genome_quality CHECK constraint.
MIMAG_TO_QUALITY: Dict[str, str] = {"HQ": "high", "MQ": "medium", "LQ": "low"}

REPO_ROOT = Path(__file__).resolve().parents[3]
GEM_DIR = REPO_ROOT / "scripts" / "populator" / "data" / "gem"
GEM_METADATA_PATH = GEM_DIR / "gem_genome_metadata.tsv"

GEM_COLUMNS: Tuple[str, ...] = (
    "genome_id", "metagenome_id", "latitude", "longitude", "ecosystem_category",
    "ecosystem_type", "habitat", "completeness", "contamination", "mimag_quality",
    "genome_length", "otu_id", "taxonomy",
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


def load_gem_metadata(path: Path = GEM_METADATA_PATH) -> Dict[str, dict]:
    out: Dict[str, dict] = {}
    for record in _read_named_rows(path, GEM_COLUMNS):
        record = {c: record[c] for c in GEM_COLUMNS}
        genome_id = record["genome_id"]
        if genome_id in out:
            raise ValueError(f"gem metadata: duplicate genome_id {genome_id!r}")
        out[genome_id] = record
    return out


def _none_if_empty(value: str) -> Optional[str]:
    return value if value != "" else None


def _finite_float(raw: str) -> Optional[float]:
    if raw is None or raw == "":
        return None
    try:
        value = float(raw)
    except ValueError:
        return None
    return value if math.isfinite(value) else None


# IMG's older GOLD vocabulary. Every GEM Arthropoda host is an insect (termites, ants,
# beetles, cockroaches, bees) and every Animal host a mammal (primates, capybara, rat).
GEM_HOST_CATEGORY: Dict[str, str] = {"Arthropoda": "Insecta", "Animal": "Mammals"}

# Insect-built habitats that IMG files under the host.
GEM_TYPE_PATH: Dict[Tuple[str, str], str] = {
    ("Arthropoda", "Ant dump"): "Environmental:Terrestrial:Nest:Insects nest",
    ("Arthropoda", "Symbiotic fungal gardens and galleries"):
        "Environmental:Terrestrial:Nest:Insects nest:Fungus garden/Fungus gallery",
}


def _gold_path(category: str, ecosystem_type: str) -> Optional[str]:
    eco = GEM_CATEGORY_TO_ECOSYSTEM.get(category)
    if eco is None:
        return None
    if (category, ecosystem_type) in GEM_TYPE_PATH:
        return GEM_TYPE_PATH[(category, ecosystem_type)]
    category = GEM_HOST_CATEGORY.get(category, category)
    if ecosystem_type == "" or ecosystem_type == "Unclassified":
        return f"{eco}:{category}"
    return f"{eco}:{category}:{ecosystem_type}"


def map_sample_fields(row: dict) -> dict:
    category = row["ecosystem_category"]
    ecosystem_type = row["ecosystem_type"]
    habitat = row["habitat"]

    lat = _finite_float(row["latitude"])
    lon = _finite_float(row["longitude"])
    genome_length = _finite_float(row["genome_length"])

    gem_fields = [
        ("genome_id", row["genome_id"]),
        ("metagenome_id", row["metagenome_id"]),
        ("otu_id", row["otu_id"]),
        ("taxonomy", row["taxonomy"]),
    ]
    gem_inner = {k: v for k, v in gem_fields if v != ""}

    return {
        "latitude": lat,
        "longitude": lon,
        "gold_ecosystem_path": _gold_path(category, ecosystem_type),
        "environment_feature": (
            None if habitat in ("", "Unclassified") else habitat),
        "location_resolution": (
            "point" if lat is not None and lon is not None else None),
        "checkm_completeness": _finite_float(row["completeness"]),
        "checkm_contamination": _finite_float(row["contamination"]),
        "genome_quality": MIMAG_TO_QUALITY.get(row["mimag_quality"]),
        "genome_size": int(genome_length) if genome_length is not None else None,
        "metadata": json.dumps({"gem": gem_inner}, separators=(",", ":")),
    }


# Loaded once per emit run.
_LOADED: Optional[Dict[str, dict]] = None


def _loaded() -> Dict[str, dict]:
    global _LOADED
    if _LOADED is None:
        _LOADED = load_gem_metadata()
    return _LOADED


def enrichment_for(accession: str) -> Optional[dict]:
    """None when the genome is absent, so the caller emits its minimal record."""
    row = _loaded().get(accession)
    if row is None:
        return None
    return map_sample_fields(row)
