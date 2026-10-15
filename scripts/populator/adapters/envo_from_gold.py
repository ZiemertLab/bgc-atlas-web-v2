"""Derive the ENVO triad from a canonical GOLD ecosystem path, for sources without ENVO.

environment_feature is the path's leaf segment; biome and material come from the longest
matching GOLD prefix.
"""
from typing import Optional

# (gold prefix, environment_biome, environment_material) -- longest prefix wins.
_RULES = [
    ("Environmental:Aquatic:Marine:Sediment", "marine biome", "marine sediment"),
    ("Environmental:Aquatic:Marine:Hydrothermal vents", "marine biome", "hydrothermal vent fluid"),
    ("Environmental:Aquatic:Marine:Cold seeps", "marine biome", "marine sediment"),
    ("Environmental:Aquatic:Marine:Intertidal zone", "marine biome", "intertidal sediment"),
    ("Environmental:Aquatic:Marine:Oceanic", "marine biome", "sea water"),
    ("Environmental:Aquatic:Marine:Pelagic", "marine biome", "sea water"),
    ("Environmental:Aquatic:Marine:Brackish", "brackish water biome", "brackish water"),
    ("Environmental:Aquatic:Marine", "marine biome", "sea water"),
    ("Environmental:Aquatic:Non-marine Saline and Alkaline", "saline water biome", "saline water"),
    ("Environmental:Aquatic:Thermal springs", "thermal spring biome", "hot spring water"),
    ("Environmental:Aquatic:Freshwater:Lake:Sediment", "freshwater biome", "freshwater sediment"),
    ("Environmental:Aquatic:Freshwater:Sediment", "freshwater biome", "freshwater sediment"),
    ("Environmental:Aquatic:Freshwater:Ice", "glacier biome", "ice"),
    ("Environmental:Aquatic:Freshwater:Glacier", "glacier biome", "ice"),
    ("Environmental:Aquatic:Freshwater:Groundwater", "freshwater biome", "groundwater"),
    ("Environmental:Aquatic:Freshwater:Wetlands", "wetland biome", "wetland water"),
    ("Environmental:Aquatic:Freshwater", "freshwater biome", "fresh water"),
    ("Environmental:Aquatic:Sediment", "aquatic biome", "sediment"),
    ("Environmental:Aquatic:Contaminated", "aquatic biome", "contaminated water"),
    ("Environmental:Aquatic", "aquatic biome", "water"),
    ("Environmental:Terrestrial:Soil:Forest soil", "forest biome", "forest soil"),
    ("Environmental:Terrestrial:Soil:Grasslands", "grassland biome", "grassland soil"),
    ("Environmental:Terrestrial:Soil:Agricultural", "cropland biome", "agricultural soil"),
    ("Environmental:Terrestrial:Soil:Wetlands", "wetland biome", "wetland soil"),
    ("Environmental:Terrestrial:Soil:Tundra", "tundra biome", "tundra soil"),
    ("Environmental:Terrestrial:Soil:Permafrost", "tundra biome", "permafrost"),
    ("Environmental:Terrestrial:Soil:Desert", "desert biome", "desert soil"),
    ("Environmental:Terrestrial:Soil:Peat", "wetland biome", "peat"),
    ("Environmental:Terrestrial:Soil:Glacier", "glacier biome", "glacial till"),
    ("Environmental:Terrestrial:Soil:Shrubland", "shrubland biome", "soil"),
    ("Environmental:Terrestrial:Soil:Contaminated", "terrestrial biome", "contaminated soil"),
    ("Environmental:Terrestrial:Soil", "terrestrial biome", "soil"),
    ("Environmental:Terrestrial:Deep subsurface", "terrestrial biome", "subsurface material"),
    ("Environmental:Terrestrial:Geologic", "terrestrial biome", "rock"),
    ("Environmental:Terrestrial", "terrestrial biome", "soil"),
    ("Environmental:Air", "air", "air"),
    ("Environmental", "terrestrial biome", "environmental material"),
    ("Host-associated:Human:Digestive system:Large intestine:Fecal",
     "host-associated habitat", "feces"),
    ("Host-associated:Human:Digestive system", "host-associated habitat", "gut content"),
    ("Host-associated:Human:Respiratory system", "host-associated habitat", "respiratory material"),
    ("Host-associated:Human:Circulatory system", "host-associated habitat", "blood"),
    ("Host-associated:Human:Excretory system", "host-associated habitat", "urine"),
    ("Host-associated:Human:Reproductive system", "host-associated habitat", "urogenital material"),
    ("Host-associated:Human:Skin", "host-associated habitat", "skin material"),
    ("Host-associated:Human:Nervous system", "host-associated habitat", "nervous tissue"),
    ("Host-associated:Human", "host-associated habitat", "host tissue"),
    ("Host-associated:Mammals:Digestive system:Large intestine:Fecal",
     "host-associated habitat", "feces"),
    ("Host-associated:Mammals:Digestive system", "host-associated habitat", "gut content"),
    ("Host-associated:Mammals", "host-associated habitat", "host tissue"),
    ("Host-associated:Plants:Rhizosphere", "plant-associated habitat", "rhizosphere soil"),
    ("Host-associated:Plants:Roots", "plant-associated habitat", "root material"),
    ("Host-associated:Plants", "plant-associated habitat", "plant material"),
    ("Host-associated:Birds", "host-associated habitat", "host tissue"),
    ("Host-associated:Fish", "host-associated habitat", "host tissue"),
    ("Host-associated:Arthropoda", "host-associated habitat", "host tissue"),
    ("Host-associated:Insecta", "host-associated habitat", "host tissue"),
    ("Host-associated:Invertebrates", "host-associated habitat", "host tissue"),
    ("Host-associated:Porifera", "host-associated habitat", "host tissue"),
    ("Host-associated:Cnidaria", "host-associated habitat", "host tissue"),
    ("Host-associated:Mollusca", "host-associated habitat", "host tissue"),
    ("Host-associated:Fungi", "host-associated habitat", "fungal material"),
    ("Host-associated:Algae", "host-associated habitat", "algal material"),
    ("Host-associated", "host-associated habitat", "host material"),
    ("Engineered:Wastewater:Sludge", "anthropogenic biome", "sludge"),
    ("Engineered:Wastewater", "anthropogenic biome", "wastewater"),
    ("Engineered:Bioreactor", "anthropogenic biome", "bioreactor material"),
    ("Engineered:Food production", "anthropogenic biome", "food product"),
    ("Engineered:Built environment", "urban biome", "surface material"),
    ("Engineered:Solid waste", "anthropogenic biome", "waste material"),
    ("Engineered:Lab enrichment", "anthropogenic biome", "culture material"),
    ("Engineered:Modeled", "anthropogenic biome", "simulated community"),
    ("Engineered:Bioremediation", "anthropogenic biome", "contaminated material"),
    ("Engineered:Biotransformation", "anthropogenic biome", "bioreactor material"),
    ("Engineered:Industrial production", "anthropogenic biome", "industrial material"),
    ("Engineered", "anthropogenic biome", "anthropogenic material"),
]
_RULES.sort(key=lambda r: -len(r[0]))


def gold_to_envo(gold_path: Optional[str]) -> Optional[dict]:
    if not gold_path:
        return None
    for prefix, biome, material in _RULES:
        if gold_path == prefix or gold_path.startswith(prefix + ":"):
            return {"environment_biome": biome,
                    "environment_feature": gold_path.rsplit(":", 1)[-1],
                    "environment_material": material}
    return None
