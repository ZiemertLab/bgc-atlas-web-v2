"""Build the MFD-ontology -> GOLD + MIxS/ENVO crosswalk, one row per distinct
5-level MFD habitat combo.

GOLD path, biome, material and package come from the (sampletype, areatype, hab1)
root; gold_ecosystem_path must be in data/mfd/valid_gold_paths.txt (nearest parent
when GOLD has no matching term). environment_feature is the finest MFD level.
ENVO labels are plain text, matching existing samples.environment_* values.

Output: data/mfd/mfd_gold_envo_crosswalk.tsv, reviewed by a human before the
backfill applies it.

Run:  scripts/populator/.venv/bin/python -m scripts.populator.tools.build_mfd_crosswalk
"""
import sys
from collections import Counter
from pathlib import Path

_THIS = Path(__file__).resolve()
REPO_ROOT = _THIS.parents[3]
DATA = REPO_ROOT / "scripts" / "populator" / "data" / "mfd"
FIELD_TSV = DATA / "mfd_field_metadata.tsv"
VALID_GOLD = DATA / "valid_gold_paths.txt"
OUT_TSV = DATA / "mfd_gold_envo_crosswalk.tsv"

OUT_COLUMNS = [
    "mfd_sampletype", "mfd_areatype", "mfd_hab1", "mfd_hab2", "mfd_hab3",
    "n_samples", "gold_ecosystem_path", "environment_biome",
    "environment_feature", "environment_material", "environmental_package",
    "confidence", "notes",
]

# (sampletype, areatype, hab1) -> (gold, biome, material, package, confidence, notes).
# Every `gold` must be in valid_gold_paths.txt (checked at build time).
_H = "high"; _M = "medium"; _L = "low"
ROOT_RULES = {
    ("Soil", "Agriculture", "Fields"):
        ("Environmental:Terrestrial:Soil:Agricultural", "cropland biome", "agricultural soil", "soil", _H, ""),
    ("Soil", "Agriculture (reclaimed lowland)", "Fields"):
        ("Environmental:Terrestrial:Soil:Agricultural", "cropland biome", "agricultural soil", "soil", _H, "reclaimed lowland"),
    ("Soil", "Natural", "Grassland formations"):
        ("Environmental:Terrestrial:Soil:Grasslands", "grassland biome", "grassland soil", "soil", _H, ""),
    ("Soil", "Natural", "Forests"):
        ("Environmental:Terrestrial:Soil:Forest soil", "forest biome", "forest soil", "soil", _H, ""),
    ("Soil", "Natural", "Bogs, mires and fens"):
        ("Environmental:Terrestrial:Soil:Wetlands", "mire", "peat soil", "soil", _H, ""),
    ("Soil", "Natural", "Dunes"):
        ("Environmental:Terrestrial:Soil:Sand", "coastal dune", "dune sand", "soil", _H, ""),
    ("Soil", "Natural", "Temperate heath and scrub"):
        ("Environmental:Terrestrial:Soil", "shrubland biome", "heathland soil", "soil", _M, "no GOLD heath term -> nearest parent Soil"),
    ("Soil", "Natural", "Sclerophyllous scrub"):
        ("Environmental:Terrestrial:Soil", "shrubland biome", "scrub soil", "soil", _M, "nearest parent Soil"),
    ("Soil", "Natural", "Coastal"):
        ("Environmental:Terrestrial:Soil", "coastal biome", "coastal soil", "soil", _M, "nearest parent Soil"),
    ("Soil", "Natural", "Rocky habitats and caves"):
        ("Environmental:Terrestrial:Soil", "terrestrial biome", "rock and cave soil", "soil", _L, "rocky/cave -> nearest parent Soil"),
    ("Soil", "Natural", None):
        ("Environmental:Terrestrial:Soil", "terrestrial biome", "soil", "soil", _L, "hab1 absent"),
    ("Soil", "Urban", "Greenspaces"):
        ("Environmental:Terrestrial:Soil", "urban biome", "park soil", "soil", _M, "no GOLD urban-soil term -> nearest parent Soil"),
    ("Soil", "Urban", "Roadside"):
        ("Environmental:Terrestrial:Soil", "urban biome", "roadside soil", "soil", _M, "nearest parent Soil"),
    ("Soil", "Urban", "Landfill"):
        ("Engineered:Solid waste:Landfill", "urban biome", "landfill soil", "soil", _M, ""),
    ("Soil", "Subterranean", "Urban"):
        ("Environmental:Terrestrial:Soil", "urban biome", "subterranean urban soil", "soil", _L, "subterranean -> nearest parent Soil"),
    ("Sediment", "Urban", "Freshwater"):
        ("Environmental:Aquatic:Freshwater:Sediment", "freshwater biome", "freshwater sediment", "sediment", _H, ""),
    ("Sediment", "Natural", "Freshwater"):
        ("Environmental:Aquatic:Freshwater:Sediment", "freshwater biome", "freshwater sediment", "sediment", _H, ""),
    ("Sediment", "Subterranean", "Saltwater"):
        ("Environmental:Aquatic:Marine:Sediment", "marine biome", "marine sediment", "sediment", _H, ""),
    ("Sediment", "Natural", "Saltwater"):
        ("Environmental:Aquatic:Marine:Sediment", "marine biome", "marine sediment", "sediment", _H, ""),
    ("Water", "Urban", "Wastewater"):
        ("Engineered:Wastewater", "", "wastewater", "wastewater_sludge", _H, ""),
    ("Water", "Subterranean", "Freshwater"):
        ("Environmental:Aquatic:Freshwater:Groundwater", "freshwater biome", "groundwater", "water", _H, ""),
    ("Water", "Urban", "Drinking water"):
        ("Environmental:Aquatic:Freshwater:Drinking water", "freshwater biome", "drinking water", "water", _H, ""),
    ("Water", "Natural", "Saltwater"):
        ("Environmental:Aquatic:Marine", "marine biome", "sea water", "water", _H, "fjord (brackish-marine)"),
    ("Water", "Urban", "Landfill"):
        ("Engineered:Solid waste:Landfill", "urban biome", "landfill leachate", "water", _M, ""),
    ("Other", "Urban", "Saltwater"):
        ("Environmental:Aquatic:Marine", "marine biome", "marine biofilm", "microbial_mat_biofilm", _M, "harbour/marina scraped biofilm"),
    ("Other", "Urban", "Drinking water"):
        ("Environmental:Aquatic:Freshwater:Drinking water", "freshwater biome", "sand filter biofilm", "microbial_mat_biofilm", _M, "waterworks sand filter"),
    ("Other", "Urban", "Landfill"):
        ("Engineered:Solid waste:Landfill", "urban biome", "landfill leachate", "water", _M, ""),
    ("Other", "Urban", "Biogas"):
        ("Engineered:Biogas plant", "", "anaerobic digester sludge", "wastewater_sludge", _H, ""),
    ("Other", "Urban", "Industrial"):
        ("Environmental:Aquatic:Non-marine Saline and Alkaline:Salt crystallizer pond", "", "hypersaline water", "water", _L, "saltworks; single sample"),
}

# Used only if a root is unexpectedly absent; such rows are flagged.
FALLBACK = {
    "Soil": ("Environmental:Terrestrial:Soil", "terrestrial biome", "soil", "soil"),
    "Sediment": ("Environmental:Aquatic:Sediment", "aquatic biome", "sediment", "sediment"),
    "Water": ("Environmental:Aquatic", "aquatic biome", "water", "water"),
    "Other": ("Environmental:Aquatic", "", "environmental material", "misc"),
}


def _clean(v):
    return None if v in (None, "", "None", "NA") else v


def _norm(s):
    """Normalize NBSP and whitespace. Only for the derived feature label: the mfd_*
    key columns must stay byte-identical to mfd_field_metadata.tsv for the join."""
    return " ".join(s.replace("\xa0", " ").split())


def _feature(h1, h2, h3):
    for v in (h3, h2, h1):
        if v:
            return _norm(v)
    return ""


def load_valid_gold():
    return {ln.strip() for ln in VALID_GOLD.read_text().splitlines() if ln.strip()}


def read_field_rows():
    lines = FIELD_TSV.read_text().splitlines()
    header = lines[0].split("\t")
    idx = {name: i for i, name in enumerate(header)}
    for ln in lines[1:]:
        cells = ln.split("\t")
        yield {name: _clean(cells[i]) for name, i in idx.items()}


def build():
    valid_gold = load_valid_gold()
    combos = Counter()
    for r in read_field_rows():
        key = (r["mfd_sampletype"], r["mfd_areatype"], r["mfd_hab1"],
               r["mfd_hab2"], r["mfd_hab3"])
        combos[key] += 1

    rows = []
    unmapped_roots = set()
    invalid_gold = []
    for (st, at, h1, h2, h3), n in combos.most_common():
        root = (st, at, h1)
        if root in ROOT_RULES:
            gold, biome, material, package, conf, note = ROOT_RULES[root]
        else:
            g = FALLBACK.get(st, FALLBACK["Other"])
            gold, biome, material, package = g
            conf, note = _L, f"UNMAPPED ROOT {root!r} -> sampletype fallback; REVIEW"
            unmapped_roots.add(root)
        if gold not in valid_gold:
            invalid_gold.append((root, gold))
        rows.append([
            st or "", at or "", h1 or "", h2 or "", h3 or "", str(n),
            gold, biome, _feature(h1, h2, h3), material, package, conf, note,
        ])

    if invalid_gold:
        for root, gold in invalid_gold:
            print(f"INVALID GOLD (not in valid_gold_paths.txt): {gold!r} for {root!r}",
                  file=sys.stderr)
        raise SystemExit(f"{len(invalid_gold)} crosswalk rows use non-GOLD terms; aborting.")

    OUT_TSV.write_text(
        "\t".join(OUT_COLUMNS) + "\n"
        + "\n".join("\t".join(r) for r in rows) + "\n"
    )
    total = sum(int(r[5]) for r in rows)
    print(f"wrote {OUT_TSV.relative_to(REPO_ROOT)}: {len(rows)} combos, {total} samples")
    if unmapped_roots:
        print(f"WARNING: {len(unmapped_roots)} unmapped roots hit the fallback (see notes col):",
              file=sys.stderr)
        for root in sorted(map(str, unmapped_roots)):
            print(f"  {root}", file=sys.stderr)
    conf_counts = Counter(r[11] for r in rows)
    print("confidence (combos):", dict(conf_counts))
    return 0


if __name__ == "__main__":
    sys.exit(build())
