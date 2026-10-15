"""Maps metalog measurement keys onto the curated `samples` value+unit columns.

Shared by the metalog ingest and tools/backfill_metalog_measurements.py so they stay identical.
Values and units are stored without conversion (bare keys -> unit None); different
measurements and bases (as-N, combined, rate/ratio keys) are never lumped together.
Keys are in priority order: the first with a parseable value wins.
"""
from __future__ import annotations

import re
from collections import OrderedDict
from typing import Dict, List, Optional, Tuple

# analyte -> (value_column, unit_column_or_None, OrderedDict[source_key -> unit_or_None])
ANALYTES: "OrderedDict[str, Tuple[str, Optional[str], 'OrderedDict[str, Optional[str]]']]" = OrderedDict([
    ("salinity", ("salinity", "salinity_unit", OrderedDict([
        ("salinity_psu", "psu"),
        ("salinity", None),                       # values ~0-36, psu/ppt ambiguous
        ("salinity_ppt", "ppt"),
        ("salinity_(ppt)", "ppt"),
        ("salinity_parts_per_thousand", "ppt"),
        ("salinity_perc", "%"),
        ("salinity_(%)", "%"),
        ("salinity_ppm", "ppm"),
        # excluded: chloride_based_salinity (derived proxy)
    ]))),
    ("dissolved_oxygen", ("dissolved_oxygen", "dissolved_oxygen_unit", OrderedDict([
        ("oxygen_um", "uM"),
        ("dissolved_oxygen_um", "uM"),
        ("oxygen_mg_l", "mg/L"),
        ("oxygen[mg_l]", "mg/L"),
        ("dissolved_oxygen_mg_l", "mg/L"),
        ("dissolved_oxygen_mg_per_l", "mg/L"),
        ("oxygen_sbe_ml_l", "mL/L"),
        ("dissolved_oxygen_percent", "%"),
        ("oxygen", None),
        ("dissolved_oxygen", None),
        ("dissolved_oxygen/do", None),
        # excluded: chemical_oxygen_demand*, biological_oxygen_demand*, chem_oxygen_dem,
        #           rel_to_oxygen, relation_to_oxygen, oxygenation_regime
    ]))),
    ("nitrate", ("nitrate", "nitrate_unit", OrderedDict([
        ("nitrate_um", "uM"),
        ("nitrate_mg_l", "mg/L"),
        ("nitrate_mol_l", "mol/L"),
        ("nitrate_mg_kg", "mg/kg"),
        ("nitrate", None),
        # excluded: nitrate+nitrite, nitrate_nitrite_um (combined); *_nitrogen / *-n
        #           (as-N basis); nitrate_ammonium_mg_kg (combined); rate/contribution keys
    ]))),
    ("nitrite", ("nitrite", "nitrite_unit", OrderedDict([
        ("nitrite_um", "uM"),
        ("nitrite_mg_l", "mg/L"),
        ("nitrite_ug_l", "ug/L"),
        ("nitrite", None),
        # excluded: nitrate+nitrite, nitrate_nitrite_um (combined); nitrite-n_(g/m3) (as N)
    ]))),
    ("ammonium", ("ammonium", "ammonium_unit", OrderedDict([
        ("ammonium_um", "uM"),
        ("ammonium_mm", "mM"),
        ("ammonium_mg_l", "mg/L"),
        ("ammonium_mg_kg", "mg/kg"),
        ("ammonium", None),
        # excluded: ammonia_ammonium_mg_kg / nitrate_ammonium_mg_kg (combined);
        #           *_nitrogen / ammoniacal-n (as N); denote_ammonium; rate/contribution keys
    ]))),
    ("phosphate", ("phosphate", "phosphate_unit", OrderedDict([
        ("phosphate_um", "uM"),
        ("phosphate_mol_l", "mol/L"),
        ("phosphate_(g/m3)", "g/m3"),
        ("phosphate", None),
        # excluded: all *phosphorus* (elemental P, different analyte); ratios;
        #           available_phosphate / total_phosphate_percent (fraction/percent basis)
    ]))),
    ("conductivity", ("conductivity", "conductivity_unit", OrderedDict([
        ("conductivity_us_per_cm_us_per_cm", "uS/cm"),
        ("conductivity_(µscm-1)", "uS/cm"),
        ("electrical_conductivity_us_cm", "uS/cm"),
        ("conductivity_ms_cm", "mS/cm"),
        ("electrical_conductivity_ds_m", "dS/m"),
        ("conductivity", None),
        ("conductivity.", None),                  # typo variant seen in source
        ("electrical_conductivity", None),
        ("conductance", None),
    ]))),
    ("dissolved_organic_carbon", ("dissolved_organic_carbon", "dissolved_organic_carbon_unit", OrderedDict([
        ("dissolved_organic_carbon_ppm", "ppm"),
        ("dissolved_organic_carbon_mg_l", "mg/L"),
        ("dissolved_organic_carbon_um", "uM"),
        ("dissolved_organic_carbon/doc__(g/m3)", "g/m3"),
        ("dissolved_organic_carbon", None),
        ("DOC", None),
        # excluded: dissolved_inorganic_carbon*, total_organic_carbon*,
        #           dissolved_carbon_dioxide, organic_carbon (soil-ambiguous),
        #           dissolved_carbon[mg_l] (org/inorg ambiguous)
    ]))),
    # Filtration size fractions — single columns, unit implied (micrometres). No unit col.
    ("filtration_lower_threshold_um", ("filtration_lower_threshold_um", None, OrderedDict([
        ("filtration_lower_threshold_um", "um"),
        # excluded: filtration_lower_threshold_kda (kDa MW cutoff — different dimension)
    ]))),
    ("filtration_upper_threshold_um", ("filtration_upper_threshold_um", None, OrderedDict([
        ("filtration_upper_threshold_um", "um"),
    ]))),
])

ALL_SOURCE_KEYS: Tuple[str, ...] = tuple(
    k for (_col, _ucol, keys) in ANALYTES.values() for k in keys
)

_RANGE = re.compile(r"^\s*([+-]?\d+(?:\.\d+)?)\s*[-–]\s*([+-]?\d+(?:\.\d+)?)\s*$")
_FLOAT = re.compile(r"[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?")
# Fallback when the key implies no unit.
_VALUE_UNIT = [
    # Case-sensitive on the 'M' so 'um' (micrometre) is not read as micromolar.
    (re.compile(r"[µu]mol\s*/?\s*l|(?<![A-Za-z])[µu]M(?![A-Za-z])"), "uM"),
    (re.compile(r"\bmg\s*/?\s*kg\b", re.I), "mg/kg"),
    (re.compile(r"\bmg\s*/?\s*l\b|\bppm\b", re.I), "mg/L"),
    (re.compile(r"\bµs\s*/?\s*cm\b|\bus\s*/?\s*cm\b", re.I), "uS/cm"),
    (re.compile(r"\bms\s*/?\s*cm\b", re.I), "mS/cm"),
    (re.compile(r"\bpsu\b", re.I), "psu"),
    (re.compile(r"\bppt\b", re.I), "ppt"),
    (re.compile(r"%"), "%"),
]


def parse_numeric(raw: str) -> Optional[float]:
    """'5-10' -> 7.5, '5 mg/L' -> 5.0, '<0.1' -> 0.1; None if no number is present."""
    if raw is None:
        return None
    s = raw.strip()
    if not s:
        return None
    m = _RANGE.match(s)
    if m:
        return (float(m.group(1)) + float(m.group(2))) / 2.0
    m = _FLOAT.search(s)
    return float(m.group(0)) if m else None


def detect_unit_in_value(raw: str) -> Optional[str]:
    if not raw:
        return None
    for rx, unit in _VALUE_UNIT:
        if rx.search(raw):
            return unit
    return None


def consolidate(measurements: List[Tuple[str, str]]) -> Dict[str, object]:
    # Keys match case-insensitively: metalog's newer layout spells the micromolar keys *_uM.
    by_key: Dict[str, str] = {}
    for k, v in measurements:
        k = k.lower()
        if k not in by_key and v is not None and str(v).strip() != "":
            by_key[k] = v

    out: Dict[str, object] = {}
    for _analyte, (col, unit_col, keys) in ANALYTES.items():
        for src_key, unit in keys.items():
            raw = by_key.get(src_key.lower())
            if raw is None:
                continue
            val = parse_numeric(raw)
            if val is None:
                continue
            out[col] = val
            if unit_col is not None:
                out[unit_col] = unit if unit is not None else detect_unit_in_value(raw)
            break
    return out
