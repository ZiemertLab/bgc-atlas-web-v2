"""Conservative crosswalk from free-text aquatic habitat to a deeper GOLD path, for samples
stuck at Environmental:Aquatic[:Marine|:Freshwater]. At bare Environmental:Aquatic a branch is
added only when the feature names it unambiguously.

Every target already exists in the DB. Rules are ordered specific-before-general; excludes
guard false positives.
"""
from typing import List, Optional, Tuple

Rule = Tuple[Tuple[str, ...], str, Tuple[str, ...]]  # (keywords, subpath, excludes)

_MARINE: List[Rule] = [
    (("estuary", "estuarine", "estuaries"),          "Intertidal zone:Estuary", ()),
    (("salt marsh", "saltmarsh"),                    "Intertidal zone:Salt marsh", ()),
    (("tidal flat", "mud flat", "mudflat"),          "Intertidal zone:Tidal flats", ()),
    (("coral reef",),                                "Intertidal zone:Coral reef", ()),
    (("mangrove",),                                  "Intertidal zone:Mangrove sediment", ()),
    (("intertidal",),                                "Intertidal zone", ()),
    (("hydrothermal", "vent fluid", "black smoker"), "Hydrothermal vents", ()),
    (("cold seep",),                                 "Cold seeps", ()),
    (("sea ice",),                                   "Sea ice", ()),
    # sediment/seafloor beats the water-column zones (a "deep-sea sediment" is benthic, not Oceanic).
    (("sediment", "seafloor", "sea floor", "sea-floor", "benthic"),
                                                     "Sediment", ()),
    (("aphotic", "abyssal", "abyssopelagic", "hadal", "hadopelagic", "bathypelagic"),
                                                     "Oceanic:Aphotic zone", ()),
    # deep chlorophyll maximum sits at the base of the photic zone (still lit) -> Photic zone.
    (("photic", "euphotic", "epipelagic", "chlorophyll"),
                                                     "Oceanic:Photic zone", ()),
    # surface water = the surface/pelagic layer; must beat bare "ocean" below.
    (("surface water", "surface seawater", "surface sea water", "sea surface"),
                                                     "Pelagic zone", ()),
    (("deep ocean", "deep sea", "deep-sea", "oceanic", "open ocean", "ocean"),
                                                     "Oceanic", ()),
    (("coastal", "neritic", "nearshore", "near-shore", "littoral", "fjord"),
                                                     "Coastal", ()),
    (("brackish",),                                  "Brackish", ()),
    (("pelagic", "seawater", "sea water", "water column"),
                                                     "Pelagic zone", ()),
]

_FRESH: List[Rule] = [
    (("lake sediment",),                             "Lake:Sediment", ()),
    (("river sediment",),                            "River:Sediment", ()),
    (("lake", "lacustrine"),                         "Lake", ()),
    (("river", "riverine"),                          "River", ()),
    (("creek", "stream"),                            "Creek", ()),
    (("groundwater", "ground water", "aquifer", "borehole"),
                                                     "Groundwater", ()),
    (("wetland", "peatland", "peat", "bog", "fen ", " fen", "swamp", "marsh", "mire"),
                                                     "Wetlands", ()),
    (("pond",),                                      "Pond", ()),
    (("glacier", "glacial"),                         "Glacier", ()),
    (("ice", "snow"),                                "Ice", ("service", "machine", "device")),
    (("drinking water", "tap water", "potable", "drinking-water"),
                                                     "Drinking water", ()),
    (("reservoir",),                                 "Reservoir", ()),
    (("rainwater", "rain water"),                    "Rainwater", ()),
    (("sediment",),                                  "Sediment", ()),
    (("lentic",),                                    "Lentic", ()),
    (("lotic",),                                     "Lotic", ()),
]

_AQUATIC: List[Rule] = [
    (("saline lake",),                               "Non-marine Saline and Alkaline:Saline lake", ()),
    (("soda lake",),                                 "Non-marine Saline and Alkaline:Soda lake", ()),
    (("hypersaline",),                               "Non-marine Saline and Alkaline:Hypersaline", ()),
    (("salt crystallizer", "solar saltern"),         "Non-marine Saline and Alkaline:Salt crystallizer ponds", ()),
    (("hot spring", "hot springs"),                  "Thermal springs:Hot (42-90C)", ()),
    (("thermal spring", "geothermal", "hot lake", "hydrothermal spring"),
                                                     "Thermal springs", ()),
    (("marine hydrothermal", "deep-sea vent", "deep sea vent"),
                                                     "Marine:Hydrothermal vents", ()),
    (("estuary", "estuarine"),                       "Marine:Intertidal zone:Estuary", ()),
    (("river water", "river ", "riverine"),          "Freshwater:River", ()),
    (("freshwater lake", "underground lake"),        "Freshwater:Lake", ()),
    (("pond",),                                      "Freshwater:Pond", ()),
    # ocean/seawater phrases are safe substrings; bare "sea" is handled by _AQUATIC_EXACT
    # (it would false-match "re-SEA-rch" etc.). Guard the odd saline "seas" (Caspian/Aral).
    (("sea water", "seawater", "sea surface", "open ocean", "ocean water", "ocean surface", "ocean"),
                                                     "Marine:Pelagic zone", ("caspian", "aral")),
    (("coastal", "nearshore"),                       "Marine:Coastal", ()),
    (("glacier",),                                   "Freshwater:Glacier", ()),
]

# Whole-string matches for short words too risky as substrings (e.g. "sea" in "research").
_EXACT = {
    "Environmental:Aquatic": {
        "sea": "Environmental:Aquatic:Marine:Pelagic zone",
    },
}

_BRANCHES = {
    "Environmental:Aquatic:Marine": _MARINE,
    "Environmental:Aquatic:Freshwater": _FRESH,
    "Environmental:Aquatic": _AQUATIC,
}


def aquatic_deepen(current_path: Optional[str], feature: Optional[str]) -> Optional[str]:
    rules = _BRANCHES.get(current_path)
    if rules is None or not feature:
        return None
    f = feature.strip().lower()
    if not f:
        return None
    exact = _EXACT.get(current_path, {}).get(f)
    if exact:
        return exact
    for keywords, subpath, excludes in rules:
        if any(x in f for x in excludes):
            continue
        if any(k in f for k in keywords):
            return f"{current_path}:{subpath}"
    return None
