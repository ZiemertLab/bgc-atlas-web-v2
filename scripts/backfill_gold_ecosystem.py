#!/usr/bin/env python3
"""
Backfill samples.gold_ecosystem_path from MGnify biome hierarchies, ENVO terms and
MIxS environmental packages.

Usage:
    python3 scripts/backfill_gold_ecosystem.py [--dry-run] [--batch-size=1000]

Environment:
    DATABASE_URL - PostgreSQL connection string (or DATABASE_URL= in the repo .env)
"""

import os
import sys
import argparse
import csv
import json
import re
from datetime import datetime
from typing import Dict, List, Optional, Tuple
from collections import defaultdict

try:
    import psycopg2
    from psycopg2.extras import execute_values, RealDictCursor
except ImportError:
    print("Error: psycopg2 not installed. Install with: pip install psycopg2-binary")
    sys.exit(1)

ENVO_TO_GOLD: Dict[str, str] = {
    "ENVO:00000447": "Environmental:Aquatic:Marine",
    "ENVO:00000446": "Environmental:Terrestrial",
    "ENVO:00000873": "Environmental:Aquatic:Freshwater",
    "ENVO:00002261": "Environmental:Terrestrial:Soil:Forest soil",
    "ENVO:00002259": "Environmental:Terrestrial:Soil:Agricultural land",
    "ENVO:00005750": "Environmental:Terrestrial:Soil:Grasslands",
    "ENVO:00002113": "Environmental:Aquatic:Marine:Sediment",
    "ENVO:00002114": "Environmental:Aquatic:Freshwater:Sediment",
    "ENVO:09200008": "Host-associated:Human:Digestive system",
    "ENVO:00005801": "Host-associated:Plants:Rhizosphere",
    "ENVO:00000304": "Environmental:Aquatic:Marine:Coastal",
    "ENVO:01001357": "Environmental:Terrestrial:Desert",
    "ENVO:00000043": "Environmental:Terrestrial:Soil:Wetlands",
    "ENVO:00000045": "Environmental:Aquatic:Marine:Intertidal zone:Estuary",
    "ENVO:00000020": "Environmental:Aquatic:Freshwater:Lake",
    "ENVO:00000022": "Environmental:Aquatic:Freshwater:River",
    "ENVO:00002030": "Environmental:Aquatic",
    "ENVO:00001998": "Environmental:Terrestrial:Soil",
    "ENVO:00002006": "Environmental:Aquatic",
    "ENVO:01001209": "Environmental:Terrestrial:Soil:Wetlands",
    "ENVO:00000243": "Environmental:Aquatic:Freshwater:Wetlands",
    "ENVO:01001305": "Environmental:Terrestrial",
    "ENVO:01000001": "Environmental:Aquatic:Sediment",
    "ENVO:01000228": "Environmental:Terrestrial:Soil:Tropical forest",
    "ENVO:01000212": "Environmental:Terrestrial:Soil:Forest soil",

    "marine": "Environmental:Aquatic:Marine",
    "marine biome": "Environmental:Aquatic:Marine",
    "marine sediment": "Environmental:Aquatic:Marine:Sediment",
    "marine pelagic biome": "Environmental:Aquatic:Marine:Pelagic zone",
    "coastal sea water": "Environmental:Aquatic:Marine:Coastal",
    "estuary": "Environmental:Aquatic:Marine:Intertidal zone:Estuary",
    "freshwater": "Environmental:Aquatic:Freshwater",
    "freshwater biome": "Environmental:Aquatic:Freshwater",
    "freshwater lake": "Environmental:Aquatic:Freshwater:Lake",
    "freshwater lake biome": "Environmental:Aquatic:Freshwater:Lake",
    "freshwater river": "Environmental:Aquatic:Freshwater:River",
    "freshwater river biome": "Environmental:Aquatic:Freshwater:River",
    "lake": "Environmental:Aquatic:Freshwater:Lake",
    "river": "Environmental:Aquatic:Freshwater:River",
    "aquatic": "Environmental:Aquatic",
    "aquatic biome": "Environmental:Aquatic",
    "freshwater sediment": "Environmental:Aquatic:Freshwater:Sediment",
    "terrestrial": "Environmental:Terrestrial",
    "terrestrial biome": "Environmental:Terrestrial",
    "soil": "Environmental:Terrestrial:Soil",
    "forest": "Environmental:Terrestrial:Soil:Forest soil",
    "forest biome": "Environmental:Terrestrial:Soil:Forest soil",
    "forest soil": "Environmental:Terrestrial:Soil:Forest soil",
    "tropical moist broadleaf forest biome": "Environmental:Terrestrial:Soil:Tropical forest",
    "temperate mixed forest biome": "Environmental:Terrestrial:Soil:Forest soil",
    "grassland biome": "Environmental:Terrestrial:Soil:Grasslands",
    "desert biome": "Environmental:Terrestrial:Desert",
    "alpine biome": "Environmental:Terrestrial:Soil:Alpine",
    "alpine soil": "Environmental:Terrestrial:Soil:Alpine",
    "tundra": "Environmental:Terrestrial:Soil:Tundra",
    "tundra biome": "Environmental:Terrestrial:Soil:Tundra",
    "wetland": "Environmental:Terrestrial:Soil:Wetlands",
    "wetland ecosystem": "Environmental:Terrestrial:Soil:Wetlands",
    "freshwater wetland ecosystem": "Environmental:Aquatic:Freshwater:Wetlands",
    "agricultural soil": "Environmental:Terrestrial:Soil:Agricultural land",
    "agricultural field": "Environmental:Terrestrial:Agricultural field",
    "human gut": "Host-associated:Human:Digestive system",
    "human skin": "Host-associated:Human:Skin",
    "plant rhizosphere": "Host-associated:Plants:Roots:Rhizosphere",
    "rhizosphere": "Host-associated:Plants:Roots:Rhizosphere",
    "sediment": "Environmental:Aquatic:Sediment",
    "air": "Environmental:Air",
    "aerosol": "Environmental:Air",
    "wastewater": "Engineered:Wastewater",
    "sewage": "Engineered:Wastewater",
    "anaerobic digester": "Engineered:Wastewater:Anaerobic digestor",
    "bioreactor": "Engineered:Bioreactor",
    "built environment": "Engineered:Built environment",

    # Paths below are unverified against the official GOLD path list.

    "aerobic bioreactor": "Engineered:Bioreactor:Aerobic",
    "anaerobic bioreactor": "Engineered:Bioreactor:Anaerobic",
    "continuous culture": "Engineered:Bioreactor:Continuous culture",
    "mesocosm": "Engineered:Artificial ecosystem:Mesocosm",
    "microcosm": "Engineered:Artificial ecosystem:Microcosm",

    "dense settlement biome": "Engineered:Built environment",
    "hospital": "Engineered:Built environment:Hospital",
    "room": "Engineered:Built environment",
    "human house": "Engineered:Built environment:House",
    "building": "Engineered:Built environment",
    "commercial building": "Engineered:Built environment:Building",
    "research facility": "Engineered:Built environment",
    "laboratory facility": "Engineered:Built environment:Building",
    "usage of an environment for residential activity": "Engineered:Built environment:House",
    "anthropogenic environment": "Engineered",
    "anthropogenic environmental material": "Engineered",
    "anthropogenic contamination feature": "Engineered",
    "motor vehicle": "Engineered:Built environment",
    "transportation": "Engineered:Built environment",
    "city": "Engineered:Built environment:City",
    "urban biome": "Engineered:Built environment",
    "currency note": "Engineered:Built environment",
    "paper product": "Engineered:Built environment",
    "shower fixture": "Engineered:Built environment",
    "sterile water": "Engineered:Built environment",

    "industrial wastewater": "Engineered:Wastewater:Industrial wastewater",
    "waste water": "Engineered:Wastewater",
    "wastewater treatment plant": "Engineered:Wastewater",
    "agricultural wastewater treatment plant": "Engineered:Wastewater",
    "sewage plant": "Engineered:Wastewater",
    "anaerobic sludge": "Engineered:Wastewater:Sludge",
    "biosolids": "Engineered:Wastewater:Sludge",
    "raw primary sludge": "Engineered:Wastewater:Sludge",
    "sludge": "Engineered:Wastewater:Sludge",
    "activated sludge": "Engineered:Wastewater:Activated Sludge",
    "compost": "Engineered:Solid waste:Composting",
    "compost soil": "Engineered:Solid waste:Composting",
    "leachate": "Engineered:Solid waste",
    "acid mine drainage": "Engineered:Wastewater:Industrial wastewater:Acid mine drainage",

    # "Engineered:Mining" is not a GOLD path; a mine working is Environmental:Terrestrial:Geologic:Mine.
    "terrestrial mining": "Environmental:Terrestrial:Geologic:Mine",
    "mine": "Environmental:Terrestrial:Geologic:Mine",
    # "pit" is also in AMBIGUOUS_BARE_TOKENS; kept here for the ENVO-text layer only.
    "pit": "Environmental:Terrestrial:Geologic:Mine",
    "oil": "Environmental:Terrestrial:Deep subsurface:Fracking water",
    "shale": "Environmental:Terrestrial:Deep subsurface:Fracking water",
    "fracking liquid": "Environmental:Terrestrial:Deep subsurface:Fracking water",
    "oil contaminated soil": "Environmental:Terrestrial:Soil",

    "temperate coniferous forest biome": "Environmental:Terrestrial:Soil:Forest soil",
    "coniferous forest biome": "Environmental:Terrestrial:Soil:Forest soil",
    "mixedwood plains": "Environmental:Terrestrial:Soil:Forest soil",
    "subpolar coniferous forest biome": "Environmental:Terrestrial:Soil:Forest soil",
    "forested area": "Environmental:Terrestrial:Soil:Forest soil",
    "area of mixed forest": "Environmental:Terrestrial:Soil:Forest soil",
    "area of evergreen forest": "Environmental:Terrestrial:Soil:Forest soil",
    "area of deciduous forest": "Environmental:Terrestrial:Soil:Forest soil",
    "bark": "Host-associated:Plants:Phyllosphere:Caulosphere:Bark",
    "plant matter": "Host-associated:Plants",
    "leaf": "Host-associated:Plants:Phyllosphere:Phylloplane/Leaf",
    "vegetated area": "Host-associated:Plants",
    "anthosphere": "Host-associated:Plants:Phyllosphere:Anthosphere",
    "nectar": "Host-associated:Plants:Phyllosphere:Anthosphere:Nectar",
    "pollen": "Host-associated:Plants:Phyllosphere:Anthosphere:Pollen",

    "cropland biome": "Environmental:Terrestrial:Agricultural field",
    "area of cropland": "Environmental:Terrestrial:Agricultural field",
    "agricultural ecosystem": "Environmental:Terrestrial:Agricultural field",
    "arable land": "Environmental:Terrestrial:Agricultural field",
    "paddy field": "Environmental:Terrestrial:Agricultural field",
    "greenhouse soil": "Environmental:Terrestrial:Soil:Greenhouse",
    "farm": "Environmental:Terrestrial:Agricultural field",
    "farm soil": "Environmental:Terrestrial:Agricultural field",
    "animal manure": "Environmental:Terrestrial:Agricultural field",
    "poultry litter": "Environmental:Terrestrial:Agricultural field",
    "banana plantation": "Environmental:Terrestrial:Agricultural field",
    "planted forest": "Environmental:Terrestrial:Agricultural field",
    "pasture soil": "Environmental:Terrestrial:Soil:Pasture",
    "pasturable land": "Environmental:Terrestrial:Soil:Pasture",
    "grassland area": "Environmental:Terrestrial:Soil:Grasslands",
    "grassland soil": "Environmental:Terrestrial:Soil:Grasslands",
    "montane grassland biome": "Environmental:Terrestrial:Soil:Grasslands",

    "woodland area": "Environmental:Terrestrial:Soil:Forest soil",

    "polar desert biome": "Environmental:Terrestrial:Soil:Desert",
    "dry valley": "Environmental:Terrestrial:Soil:Desert",
    "ice sheet": "Environmental:Terrestrial:Soil:Glacier",
    "cryosphere": "Environmental:Terrestrial:Soil:Glacier",
    "cryoconite deposit": "Environmental:Terrestrial:Soil:Glacier:Cryoconite",
    "cryoconite": "Environmental:Terrestrial:Soil:Glacier:Cryoconite",
    "cryopeg": "Environmental:Terrestrial:Subsurface",
    "ice-bearing permafrost thawing process": "Environmental:Terrestrial:Soil:Permafrost",
    "permafrost": "Environmental:Terrestrial:Soil:Permafrost",
    "anthropogenic terrestrial biome": "Engineered",
    "desert area": "Environmental:Terrestrial:Soil:Desert",
    "desert": "Environmental:Terrestrial:Soil:Desert",
    "desert sand": "Environmental:Terrestrial:Soil:Desert",
    "gibber plain": "Environmental:Terrestrial:Soil:Desert:Gibber plain",

    "continental subsurface zone": "Environmental:Terrestrial:Deep subsurface",
    "endolithic environment": "Environmental:Terrestrial:Rock-dwelling (endoliths)",
    "rock": "Environmental:Terrestrial:Geologic",
    "sandstone": "Environmental:Terrestrial:Geologic",
    "cliff": "Environmental:Terrestrial:Geologic",
    "saprolite": "Environmental:Terrestrial:Saprolite–Bedrock interface",
    "bedrock": "Environmental:Terrestrial:Soil-bedrock interface",
    "regolith": "Environmental:Terrestrial:Regolith",
    "volcanic": "Environmental:Terrestrial:Volcanic",
    "geothermal field": "Environmental:Terrestrial:Soil:Geothermal field",
    "mud volcano": "Environmental:Terrestrial:Mud volcano",
    "asphalt lakes": "Environmental:Terrestrial:Asphalt lakes",

    "valley": "Environmental:Terrestrial:Floodplain",
    "river valley": "Environmental:Terrestrial:Floodplain",
    "plain": "Environmental:Terrestrial:Soil",
    "upland soil": "Environmental:Terrestrial:Soil",
    "surface soil": "Environmental:Terrestrial:Soil",
    "bulk soil": "Environmental:Terrestrial:Soil",
    "soil environment": "Environmental:Terrestrial:Soil",
    "field soil": "Environmental:Terrestrial:Soil:Agricultural land",
    "field": "Environmental:Terrestrial:Soil:Agricultural land",
    "watershed": "Environmental:Terrestrial:Soil",
    "mountain": "Environmental:Terrestrial:Soil",
    "plateau": "Environmental:Terrestrial:Soil",
    "populated place": "Engineered:Built environment",
    "informal settlement": "Engineered:Built environment",
    "city park": "Engineered:Built environment",
    "garden": "Environmental:Terrestrial:Soil:Garden",
    "botanical garden": "Engineered:Built environment",
    "green roof": "Engineered:Built environment",
    "flood plain": "Environmental:Terrestrial:Floodplain",
    "lakeshore": "Environmental:Terrestrial:Soil:Lakeshore",
    "sand": "Environmental:Terrestrial:Soil",
    "gravel": "Environmental:Terrestrial:Soil",
    "biocrust": "Environmental:Terrestrial:Soil:Biocrust",
    "soil biocrust": "Environmental:Terrestrial:Soil:Biocrust",

    "lake water": "Environmental:Aquatic:Freshwater:Lake",
    "lake sediment": "Environmental:Aquatic:Freshwater:Lake:Sediment",
    "lake bottom mud": "Environmental:Aquatic:Freshwater:Lake:Sediment",
    "underground lake": "Environmental:Aquatic:Deep subsurface:Subterranean lake",
    "large lake biome": "Environmental:Aquatic:Freshwater:Lake",
    "small lake biome": "Environmental:Aquatic:Freshwater:Lake",
    "lentic": "Environmental:Aquatic:Freshwater:Lentic",
    "lentic water body": "Environmental:Aquatic:Freshwater:Lentic",
    "pond": "Environmental:Aquatic:Freshwater:Pond",
    "pond water": "Environmental:Aquatic:Freshwater:Pond",
    "reservoir": "Environmental:Aquatic:Freshwater:Reservoir",
    "drinking water reservoir": "Environmental:Aquatic:Freshwater:Drinking water",
    "hypereutrophic lake": "Environmental:Aquatic:Freshwater:Lake",
    "mesotrophic lake": "Environmental:Aquatic:Freshwater:Lake",
    "bog lake": "Environmental:Aquatic:Freshwater:Bog lake",
    "floodplain lake": "Environmental:Aquatic:Freshwater:Floodplain lake",

    "freshwater stream": "Environmental:Aquatic:Freshwater:Creek",
    "stream": "Environmental:Aquatic:Freshwater:Creek",
    "creek": "Environmental:Aquatic:Freshwater:Creek",
    "channel": "Environmental:Aquatic:Freshwater",
    "stream sediment": "Environmental:Aquatic:Freshwater:Creek:Sediment",
    "river water": "Environmental:Aquatic:Freshwater:River",
    "river bed": "Environmental:Aquatic:Freshwater:River:Sediment",
    "river bank": "Environmental:Aquatic:Freshwater:River",
    "large river biome": "Environmental:Aquatic:Freshwater:River",
    "small river biome": "Environmental:Aquatic:Freshwater:River",
    "drainage ditch": "Environmental:Aquatic:Freshwater:Drainage ditch",
    "ditch": "Environmental:Aquatic:Freshwater:Drainage ditch",
    "ditch water": "Environmental:Aquatic:Freshwater:Drainage ditch",
    "canal": "Environmental:Aquatic:Freshwater:Canal",

    "groundwater": "Environmental:Aquatic:Deep subsurface:Groundwater",
    "aquifer": "Environmental:Aquatic:Deep subsurface:Groundwater",
    "well": "Environmental:Aquatic:Deep subsurface:Groundwater:Well",
    "underground water": "Environmental:Aquatic:Deep subsurface:Groundwater",
    "mine water": "Environmental:Aquatic:Deep subsurface:Groundwater:Mine water",
    "coalbed methane well water": "Environmental:Aquatic:Deep subsurface:Groundwater:Coalbed methane well water",

    "surface water": "Environmental:Aquatic",
    "water body": "Environmental:Aquatic",
    "liquid water": "Environmental:Aquatic",
    "fresh water": "Environmental:Aquatic:Freshwater",
    "drinking water": "Environmental:Aquatic:Freshwater",
    "aquatic environment": "Environmental:Aquatic",

    "saline lake": "Environmental:Aquatic:Non-marine Saline and Alkaline:Saline lake",
    "saline water": "Environmental:Aquatic:Non-marine Saline and Alkaline",
    "alkaline water": "Environmental:Aquatic:Non-marine Saline and Alkaline",
    "alkaline salt lake": "Environmental:Aquatic:Non-marine Saline and Alkaline:Soda lake",
    "hypersaline lake": "Environmental:Aquatic:Non-marine Saline and Alkaline:Hypersaline lake",
    "hypersaline soda lake": "Environmental:Aquatic:Non-marine Saline and Alkaline:Hypersaline soda lake",
    "highly saline water": "Environmental:Aquatic:Non-marine Saline and Alkaline:Hypersaline lake",
    "saline water body": "Environmental:Aquatic:Non-marine Saline and Alkaline",
    "brine": "Environmental:Aquatic:Non-marine Saline and Alkaline:Lake:Brine",
    "brine pool": "Environmental:Aquatic:Marine:Deepwater/Brine lake",
    "hypersaline water environment": "Environmental:Aquatic:Non-marine Saline and Alkaline:Hypersaline lake",
    "soda lake": "Environmental:Aquatic:Non-marine Saline and Alkaline:Soda lake",

    "hot spring": "Environmental:Aquatic:Thermal springs",

    "marine salt marsh biome": "Environmental:Aquatic:Marine:Intertidal zone:Salt marsh",
    "saline marsh": "Environmental:Aquatic:Marine:Intertidal zone:Salt marsh",
    "salt marsh": "Environmental:Aquatic:Marine:Intertidal zone:Salt marsh",
    "salt marsh sediment": "Environmental:Aquatic:Marine:Intertidal zone:Salt marsh sediment",
    "sea shore": "Environmental:Aquatic:Marine:Intertidal zone:Beach/Shore",
    "sea coast": "Environmental:Aquatic:Marine:Intertidal zone:Beach/Shore",
    "rocky shore": "Environmental:Aquatic:Marine:Intertidal zone:Beach/Shore",
    "area of rocky shore": "Environmental:Aquatic:Marine:Intertidal zone:Beach/Shore",
    "tidal flats": "Environmental:Aquatic:Marine:Intertidal zone:Tidal flats",
    "mangrove area": "Environmental:Aquatic:Marine:Intertidal zone:Mangrove area",
    "mangrove sediment": "Environmental:Aquatic:Marine:Intertidal zone:Mangrove sediment",
    "mangrove swamp": "Environmental:Aquatic:Marine:Intertidal zone:Mangrove swamp",
    "seagrass bed": "Environmental:Aquatic:Marine:Intertidal zone:Seagrass bed",

    "marine reef biome": "Environmental:Aquatic:Marine:Intertidal zone:Coral reef",
    "marine coral reef biome": "Environmental:Aquatic:Marine:Intertidal zone:Coral reef",
    "coral reef": "Environmental:Aquatic:Marine:Intertidal zone:Coral reef",

    "marine hydrothermal vent biome": "Environmental:Aquatic:Marine:Hydrothermal vents",
    "marine hydrothermal vent": "Environmental:Aquatic:Marine:Hydrothermal vents",
    "hydrothermal vent": "Environmental:Aquatic:Marine:Hydrothermal vents",
    "black smokers": "Environmental:Aquatic:Marine:Hydrothermal vents:Black smokers",
    "white smokers": "Environmental:Aquatic:Marine:Hydrothermal vents:White smokers",

    "estuarine biome": "Environmental:Aquatic:Marine:Intertidal zone:Estuary",
    "estuarine coastal surface layer": "Environmental:Aquatic:Marine:Intertidal zone:Estuary",
    "estuarine water": "Environmental:Aquatic:Marine:Intertidal zone:Estuary",

    "ocean biome": "Environmental:Aquatic:Marine",
    "ocean": "Environmental:Aquatic:Marine",
    "neritic epipelagic zone biome": "Environmental:Aquatic:Marine:Epipelagic",
    "oceanic bathypelagic zone biome": "Environmental:Aquatic:Marine:Bathypelagic",
    "abyssopelagic": "Environmental:Aquatic:Marine:Abyssopelagic",
    "hadalpelagic": "Environmental:Aquatic:Marine:Hadalpelagic",
    "demersal zone": "Environmental:Aquatic:Marine:Demersal zone",

    "marine benthic biome": "Environmental:Aquatic:Marine:Benthic zone",
    "marine benthic feature": "Environmental:Aquatic:Marine:Benthic zone",
    "benthic": "Environmental:Aquatic:Marine:Benthic zone",
    "coast": "Environmental:Aquatic:Marine:Coastal",
    "coastal water body": "Environmental:Aquatic:Marine:Coastal",
    "coastal area": "Environmental:Aquatic:Marine:Coastal",
    "inlet": "Environmental:Aquatic:Marine:Inlet",
    "bay": "Environmental:Aquatic:Marine:Coastal",
    "peninsula": "Environmental:Aquatic:Marine:Coastal",
    "gulf": "Environmental:Aquatic:Marine:Gulf",
    "fjord": "Environmental:Aquatic:Marine:Fjord",
    "harbor": "Environmental:Aquatic:Marine:Harbor",
    "cold seeps": "Environmental:Aquatic:Marine:Cold seeps",
    "cold seep": "Environmental:Aquatic:Marine:Cold seeps",
    "oil seep": "Environmental:Aquatic:Marine:Cold seeps",
    "sea water": "Environmental:Aquatic:Marine",
    "sea": "Environmental:Aquatic:Marine",
    "planktonic material": "Environmental:Aquatic:Marine",
    "mediterranean sea biome": "Environmental:Aquatic:Marine",
    "shallow marine sediment": "Environmental:Aquatic:Marine:Coastal:Sediment",
    "deep marine sediment": "Environmental:Aquatic:Marine:Deep subsurface:Sediment",
    "continental margin": "Environmental:Aquatic:Marine:Continental margin",
    "continental shelf": "Environmental:Aquatic:Marine:Coastal",

    "marine chemocline": "Environmental:Aquatic:Marine",

    "anaerobic mud": "Environmental:Aquatic:Sediment",
    "mud": "Environmental:Aquatic:Sediment",
    "anaerobic sediment": "Environmental:Aquatic:Sediment",

    "glacier stream": "Environmental:Aquatic:Freshwater:Glacier:Glacier stream",
    "glacial feature": "Environmental:Aquatic:Freshwater:Glacier",
    "cryoconite hole": "Environmental:Aquatic:Freshwater:Glacier:Cryoconite hole",
    "ice": "Environmental:Aquatic:Freshwater:Ice",
    "sea ice": "Environmental:Aquatic:Marine:Ice shelf",
    "glacier": "Environmental:Aquatic:Freshwater:Glacier",
    "snow": "Environmental:Aquatic:Freshwater:Ice",

    "animal aquaculture process": "Environmental:Aquatic:Aquaculture",
    "limestone cave": "Environmental:Terrestrial:Cave",
    "cave lake": "Environmental:Aquatic:Deep subsurface:Groundwater:Cave lake",
    "cave pool": "Environmental:Aquatic:Deep subsurface:Groundwater:Cave pool",
    "cave stream": "Environmental:Aquatic:Deep subsurface:Groundwater:Cave stream",
    "cave water": "Environmental:Aquatic:Freshwater:Groundwater:Cave water",
    "canyon": "Environmental:Terrestrial",
    "pond soil": "Environmental:Aquatic:Freshwater:Pond",
    "pit lake": "Environmental:Aquatic:Pit lake",
    "floodplain": "Environmental:Aquatic:Floodplain",

    "wetlands": "Environmental:Aquatic:Freshwater:Wetlands",
    "bog": "Environmental:Aquatic:Freshwater:Wetlands:Bog",
    "fen": "Environmental:Aquatic:Freshwater:Wetlands:Fen",
    "marsh": "Environmental:Aquatic:Freshwater:Wetlands:Marsh",
    "swamp": "Environmental:Aquatic:Freshwater:Wetlands:Swamp",

    "peatland": "Environmental:Terrestrial:Soil:Peat",
    "peat soil": "Environmental:Terrestrial:Soil:Peat",
    "palsa": "Environmental:Terrestrial:Soil:Peat:Palsa",
    "blanket bog": "Environmental:Terrestrial:Soil:Peat:Bog",
    "wetland area": "Environmental:Terrestrial:Soil:Wetlands",
    "saline wetland": "Environmental:Terrestrial:Soil:Wetlands:Salt marsh",
    "coastal wetland ecosystem": "Environmental:Aquatic:Marine:Intertidal zone:Salt marsh",

    "dust": "Environmental:Air:Indoor Air:Dust",
    "particulate matter": "Environmental:Air",
    "bioaerosol": "Environmental:Air",
    "organic material": "Environmental",
    "detritus": "Environmental",
    "tropical soil": "Environmental:Terrestrial:Soil",

    "environment determined by a plant substance": "Host-associated:Plants",
    "plant-associated environment": "Host-associated:Plants",
    "rhizosphere environment": "Host-associated:Plants:Roots:Rhizosphere",
    "root matter": "Host-associated:Plants:Roots",
    "rhizoplane": "Host-associated:Plants:Roots:Rhizoplane",
    "plant litter": "Environmental:Terrestrial:Plant litter",
    "wood": "Host-associated:Plants:Wood",

    "human": "Host-associated:Human",
    "skin environment": "Host-associated:Human:Skin",
    "sebum material": "Host-associated:Human:Skin",

    "animal-associated environment": "Host-associated",
    "environment determined by a biofilm on an animal surface": "Host-associated",
    "nest of ant": "Environmental:Terrestrial:Nest",
    "mucus material": "Host-associated",

    "fluid environmental material": "Environmental:Aquatic",
    "body of liquid": "Environmental:Aquatic",

    "contaminated water": "Environmental:Aquatic:Freshwater:Groundwater:Contaminated",
}

# Context-dependent words (e.g. a "pit" is often a baijiu fermentation pit, not a mine).
# Denied only in the bare feature/material fallback; the combined-key and ENVO-text layers
# still use them. Deny only what is shown to do harm: each entry costs coverage.
AMBIGUOUS_BARE_TOKENS = frozenset({
    "pit", "farm", "channel", "mud",
})

MIXS_TO_GOLD: Dict[str, str] = {
    "air": "Environmental:Air",
    "soil": "Environmental:Terrestrial:Soil",
    "water": "Environmental:Aquatic",
    "sediment": "Environmental:Aquatic:Sediment",
    "host-associated": "Host-associated",
    "human-associated": "Host-associated:Human",
    "human-gut": "Host-associated:Human:Digestive system",
    "human-oral": "Host-associated:Human:Digestive system:Oral",
    "human-skin": "Host-associated:Human:Skin",
    "human-vaginal": "Host-associated:Human:Reproductive system",
    "plant-associated": "Host-associated:Plants",
    "built": "Engineered:Built environment",
    "microbial": None,  # a mat or biofilm, but not where; GOLD has no general node
    "misc": None,  # Too ambiguous, skip
}

# feature|material|package (or a 2-field pair) -> GOLD path
COMBINED_TO_GOLD: Dict[str, str] = {
    "forest|soil|soil": "Environmental:Terrestrial:Soil:Forest soil",
    "lake|fresh water|water": "Environmental:Aquatic:Freshwater:Lake",
    "coast|saline wetland|misc": "Environmental:Aquatic:Marine:Intertidal zone:Salt marsh",
    "peatland|peat soil|misc": "Environmental:Terrestrial:Soil:Peat",
    "grassland area|soil|soil": "Environmental:Terrestrial:Soil:Grasslands",
    "desert|biocrust|soil": "Environmental:Terrestrial:Soil:Biocrust",
    "human house|dust|misc": "Engineered:Built environment:House",
    "hospital|hospital|built": "Engineered:Built environment:Hospital",
    "rhizosphere environment|soil|plant-associated": "Host-associated:Plants:Roots:Rhizosphere",
    "leaf|plant matter|plant-associated": "Host-associated:Plants:Phyllosphere:Phylloplane/Leaf",
    "forest soil|soil|soil": "Environmental:Terrestrial:Soil:Forest soil",
    "lake|water|water": "Environmental:Aquatic:Freshwater:Lake",
    "marine sediment|sediment|sediment": "Environmental:Aquatic:Marine:Sediment",
    "freshwater sediment|sediment|sediment": "Environmental:Aquatic:Freshwater:Sediment",
    "river|fresh water|water": "Environmental:Aquatic:Freshwater:River",
    "stream|fresh water|water": "Environmental:Aquatic:Freshwater:Creek",
    "mangrove|sediment|sediment": "Environmental:Aquatic:Marine:Intertidal zone:Mangrove sediment",
    "salt marsh|saline wetland|misc": "Environmental:Aquatic:Marine:Intertidal zone:Salt marsh",
    "wetland|soil|soil": "Environmental:Terrestrial:Soil:Wetlands",
    "peat|peat soil|soil": "Environmental:Terrestrial:Soil:Peat",

    # Must beat the generic MIxS package "sediment".
    "permafrost|sediment": "Environmental:Terrestrial:Soil:Permafrost",
    # Baijiu fermentation-cellar pit mud: neither bare word is unambiguous, the pair is.
    "pit|mud": "Engineered:Food production:Fermented beverages",
    # The MIxS package is collection-level (package="soil" here) and would otherwise outrank
    # the material.
    "drainage basin|waste water": "Engineered:Wastewater",

    # Engineered features otherwise outranked by a coarser MIxS package or ENVO biome.
    # A treatment plant is not a GOLD ecosystem, so pair it with the material.
    "wastewater treatment plant|activated sludge": "Engineered:Wastewater:Activated Sludge",
    "wastewater treatment plant|sewage": "Engineered:Wastewater:Sewage",
    "wastewater treatment plant|waste water": "Engineered:Wastewater",
    "wastewater treatment plant|sludge": "Engineered:Wastewater:Sludge",
    "agricultural wastewater treatment plant|waste water": "Engineered:Wastewater",
    "sewage plant|activated sludge": "Engineered:Wastewater:Activated Sludge",
    "sewage plant|sewage": "Engineered:Wastewater:Sewage",
    "sewage plant|biosolids": "Engineered:Wastewater:Sludge",
    "sewage plant|raw primary sludge": "Engineered:Wastewater:Sludge",
    "sewage plant|sludge": "Engineered:Wastewater:Sludge",           # Ciesielski_2019
    # Leachate alone does not mean landfill, so only the parent path.
    "leachate|liquid water": "Engineered:Solid waste",
    "waste water|sediment": "Engineered:Wastewater",                     # Chu_2017_sludge
    "waste water|waste water": "Engineered:Wastewater",                  # Chu_2017_sludge
    "city|skin environment": "Engineered:Built environment:City",        # Kang_2018_subway
    "hospital|waste water": "Engineered:Wastewater",                     # Rowe_2017
    "shower fixture|biofilm": "Engineered:Built environment",            # Soto-Giron_2016_showers
    "animal aquaculture process|liquid water": "Engineered:Artificial ecosystem:Aquaculture",  # Ramachandran_2018_oyster
    # Watts_2019_bioreactor: mine tailings were only the inoculum of a bioreactor consortium.
    "terrestrial mining|planktonic material": "Engineered:Bioreactor",
    "forest|soil": "Environmental:Terrestrial:Soil:Forest soil",
    "lake|fresh water": "Environmental:Aquatic:Freshwater:Lake",
    "lake|water": "Environmental:Aquatic:Freshwater:Lake",
    "peatland|peat soil": "Environmental:Terrestrial:Soil:Peat",
    "forest soil|soil": "Environmental:Terrestrial:Soil:Forest soil",
    "hospital|built": "Engineered:Built environment:Hospital",
    "rhizosphere environment|plant-associated": "Host-associated:Plants:Roots:Rhizosphere",
    "leaf|plant-associated": "Host-associated:Plants:Phyllosphere:Phylloplane/Leaf",
    "coast|water": "Environmental:Aquatic:Marine:Coastal",
    "groundwater|water": "Environmental:Aquatic:Freshwater:Groundwater",
    "river|water": "Environmental:Aquatic:Freshwater:River",
    "stream|water": "Environmental:Aquatic:Freshwater:Creek",
    "marine sediment|sediment": "Environmental:Aquatic:Marine:Sediment",
    "freshwater sediment|sediment": "Environmental:Aquatic:Freshwater:Sediment",
    "mangrove|sediment": "Environmental:Aquatic:Marine:Intertidal zone:Mangrove sediment",
    "salt marsh|misc": "Environmental:Aquatic:Marine:Intertidal zone:Salt marsh",
    "wetland|soil": "Environmental:Terrestrial:Soil:Wetlands",
    "peat|soil": "Environmental:Terrestrial:Soil:Peat",
    "desert|soil": "Environmental:Terrestrial:Desert",
    "grassland|soil": "Environmental:Terrestrial:Soil:Grasslands",
    "agricultural soil|soil": "Environmental:Terrestrial:Soil:Agricultural land",
    "farm|soil": "Environmental:Terrestrial:Soil:Agricultural land",
    "rhizosphere|soil": "Host-associated:Plants:Roots:Rhizosphere",
    "rhizosphere|plant-associated": "Host-associated:Plants:Roots:Rhizosphere",
    "leaf|plant matter": "Host-associated:Plants:Phyllosphere:Phylloplane/Leaf",
}


class GoldBackfillStats:
    def __init__(self):
        self.total_samples = 0
        self.already_populated = 0
        self.mapped_from_mgnify = 0
        self.mapped_from_envo_id = 0
        self.mapped_from_combined_3field = 0
        self.mapped_from_combined_2field = 0
        self.mapped_from_envo_text = 0
        self.mapped_from_mixs = 0
        self.mapped_from_feature = 0
        self.mapped_from_material = 0
        self.unmapped = 0
        self.by_ecosystem: Dict[str, int] = defaultdict(int)
        self.unmapped_samples: List[Dict] = []
        self.mapped_samples: List[Dict] = []

    def print_summary(self):
        print("\n" + "="*60)
        print("GOLD Ecosystem Backfill Summary")
        print("="*60)
        print(f"Total samples:          {self.total_samples:>10,}")
        print(f"Already populated:      {self.already_populated:>10,}")
        print("\nMapped from:")
        print(f"  MGnify biomes:        {self.mapped_from_mgnify:>10,}  (high confidence)")
        print(f"  ENVO ID:              {self.mapped_from_envo_id:>10,}  (high confidence)")
        print(f"  3-field combos:       {self.mapped_from_combined_3field:>10,}  (high confidence)")
        print(f"  2-field combos:       {self.mapped_from_combined_2field:>10,}  (medium-high confidence)")
        print(f"  ENVO text:            {self.mapped_from_envo_text:>10,}  (medium confidence)")
        print(f"  MIxS package:         {self.mapped_from_mixs:>10,}  (medium confidence)")
        print(f"  Feature field:        {self.mapped_from_feature:>10,}  (low confidence)")
        print(f"  Material field:       {self.mapped_from_material:>10,}  (low confidence)")
        print(f"\nUnmapped:               {self.unmapped:>10,}")

        total_mapped = (self.mapped_from_mgnify + self.mapped_from_envo_id +
                       self.mapped_from_combined_3field + self.mapped_from_combined_2field +
                       self.mapped_from_envo_text + self.mapped_from_mixs +
                       self.mapped_from_feature + self.mapped_from_material)
        if self.total_samples > 0:
            coverage = (total_mapped / self.total_samples) * 100
            print(f"\nCoverage:               {coverage:>10.1f}%")

        if self.by_ecosystem:
            print("\nBy ecosystem:")
            for ecosystem, count in sorted(self.by_ecosystem.items(), key=lambda x: -x[1]):
                print(f"  {ecosystem:<30} {count:>10,}")
        print("="*60 + "\n")


def get_db_connection():
    """Never falls back to a guessed database name: that risks writing the wrong DB."""
    db_url = os.environ.get('DATABASE_URL')
    if not db_url:
        env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
        if os.path.exists(env_path):
            with open(env_path) as f:
                for line in f:
                    if line.startswith('DATABASE_URL='):
                        db_url = line.split('=', 1)[1].strip().strip('"\'')
                        break

    if not db_url:
        raise SystemExit(
            "DATABASE_URL is not set (and no DATABASE_URL= in .env). "
            "Set it to the target database before running, e.g.\n"
            "  DATABASE_URL=postgresql://bgc_owner@localhost/bgc_atlas_v2 "
            "python3 scripts/backfill_gold_ecosystem.py ...")

    return psycopg2.connect(db_url)


def clean_mgnify_biome_path(biome_name: str) -> str:
    """"root:root:Environmental:root:Aquatic" -> "Environmental:Aquatic"."""
    if not biome_name:
        return None

    path = re.sub(r'(^root:|:root(?=:)|:root$)', '', biome_name)

    path = re.sub(r':+', ':', path)

    path = path.strip(':')

    return path if path else None


def extract_envo_id(text: str) -> Optional[str]:
    """Extract ENVO ID from text like 'forest soil [ENVO:00002261]'"""
    if not text:
        return None
    match = re.search(r'\[?ENVO:(\d+)\]?', text, re.IGNORECASE)
    if match:
        return f"ENVO:{match.group(1)}"
    return None


def map_to_gold(
    sample: Dict,
    envo_mapping: Dict[str, str],
    mixs_mapping: Dict[str, str],
    combined_mapping: Dict[str, str],
    priority_mode: str = 'standard'
) -> Tuple[Optional[str], str, str, Optional[str], Optional[str]]:
    """
    priority_mode: 'standard', 'feature-first' or 'combined'.
    Returns (gold_path, source, confidence, envo_text, envo_id).
    """
    envo_text = None
    envo_id = None
    if sample.get('environment_biome'):
        normalized = sample['environment_biome'].lower().strip()
        envo_text = re.sub(r'\s*\[ENVO:\d+\]', '', normalized)
        envo_id = extract_envo_id(sample['environment_biome'])

    if envo_id and envo_id in envo_mapping:
        return envo_mapping[envo_id], 'envo_id', 'high', envo_text, envo_id

    feature = sample.get('environment_feature', '').lower().strip() if sample.get('environment_feature') else ''
    material = sample.get('environment_material', '').lower().strip() if sample.get('environment_material') else ''
    package = sample.get('environmental_package', '').lower().strip() if sample.get('environmental_package') else ''

    # Ambiguous words are blanked for the single-field fallbacks only (see AMBIGUOUS_BARE_TOKENS).
    bare_feature = '' if feature in AMBIGUOUS_BARE_TOKENS else feature
    bare_material = '' if material in AMBIGUOUS_BARE_TOKENS else material

    if priority_mode == 'combined':
        # 3-field combos → 2-field combos → individual fields → ENVO text
        if feature and material and package:
            key = f"{feature}|{material}|{package}"
            if key in combined_mapping:
                return combined_mapping[key], 'combined_3field', 'high', envo_text, envo_id

        if feature and material:
            key = f"{feature}|{material}"
            if key in combined_mapping:
                return combined_mapping[key], 'combined_2field', 'medium-high', envo_text, envo_id

        if feature and package:
            key = f"{feature}|{package}"
            if key in combined_mapping:
                return combined_mapping[key], 'combined_2field', 'medium-high', envo_text, envo_id

        if material and package:
            key = f"{material}|{package}"
            if key in combined_mapping:
                return combined_mapping[key], 'combined_2field', 'medium-high', envo_text, envo_id

        if package and package in mixs_mapping and mixs_mapping[package]:
            return mixs_mapping[package], 'mixs_package', 'medium', envo_text, envo_id

        if bare_feature and bare_feature in envo_mapping:
            return envo_mapping[bare_feature], 'environment_feature', 'low', envo_text, envo_id

        if bare_material and bare_material in envo_mapping:
            return envo_mapping[bare_material], 'environment_material', 'low', envo_text, envo_id

        if envo_text and envo_text in envo_mapping:
            return envo_mapping[envo_text], 'envo_text', 'medium', envo_text, envo_id

    elif priority_mode == 'feature-first':
        # MIxS package → feature → material → ENVO text
        if package and package in mixs_mapping and mixs_mapping[package]:
            return mixs_mapping[package], 'mixs_package', 'medium', envo_text, envo_id

        if bare_feature and bare_feature in envo_mapping:
            return envo_mapping[bare_feature], 'environment_feature', 'low', envo_text, envo_id

        if bare_material and bare_material in envo_mapping:
            return envo_mapping[bare_material], 'environment_material', 'low', envo_text, envo_id

        if envo_text and envo_text in envo_mapping:
            return envo_mapping[envo_text], 'envo_text', 'medium', envo_text, envo_id

    else:
        # ENVO text → MIxS package → feature → material
        if envo_text and envo_text in envo_mapping:
            return envo_mapping[envo_text], 'envo_text', 'medium', envo_text, envo_id

        if package and package in mixs_mapping and mixs_mapping[package]:
            return mixs_mapping[package], 'mixs_package', 'medium', envo_text, envo_id

        if bare_feature and bare_feature in envo_mapping:
            return envo_mapping[bare_feature], 'environment_feature', 'low', envo_text, envo_id

        if bare_material and bare_material in envo_mapping:
            return envo_mapping[bare_material], 'environment_material', 'low', envo_text, envo_id

    return None, 'none', 'none', envo_text, envo_id


# Sample-level MVs reading gold_ecosystem_path; each has a unique index for CONCURRENTLY.
# The GCF-ecosystem MVs are excluded: without a unique index a refresh would lock site reads.
SAMPLE_FACING_MVS = [
    "sample_summary",
    "sample_map_view",
    "assembly_samples_mv",
    "bgc_gold_ecosystem_distribution_mv",
]


def refresh_sample_facing_mvs(dry_run: bool = False):
    """Autocommit: REFRESH ... CONCURRENTLY cannot run inside a transaction block."""
    print("\nRefreshing sample-facing materialized views (CONCURRENTLY)...")
    if dry_run:
        for mv in SAMPLE_FACING_MVS:
            print(f"  [DRY RUN] would REFRESH MATERIALIZED VIEW CONCURRENTLY {mv}")
        return
    conn = get_db_connection()
    conn.autocommit = True
    try:
        cur = conn.cursor()
        for mv in SAMPLE_FACING_MVS:
            start = datetime.now()
            cur.execute(f"REFRESH MATERIALIZED VIEW CONCURRENTLY {mv}")
            elapsed = (datetime.now() - start).total_seconds()
            print(f"  refreshed {mv} ({elapsed:.1f}s)")
        cur.close()
    finally:
        conn.close()


def backfill_gold_ecosystem(
    batch_size: int = 1000,
    dry_run: bool = False,
    export_unmapped: bool = True,
    export_mapped: bool = True,
    priority_mode: str = 'standard',
    override_existing: bool = False
):
    stats = GoldBackfillStats()
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    update_cur = conn.cursor()

    print("Starting GOLD Ecosystem Classification backfill...")
    print(f"Mode: {'DRY RUN' if dry_run else 'LIVE'}")
    print(f"Batch size: {batch_size}")
    print(f"Priority mode: {priority_mode}")
    print(f"Override existing: {'YES' if override_existing else 'NO'}")
    print()

    try:
        cur.execute("SELECT COUNT(*) as count FROM samples")
        stats.total_samples = cur.fetchone()['count']
        print(f"Total samples in database: {stats.total_samples:,}")

        cur.execute("SELECT COUNT(*) as count FROM samples WHERE gold_ecosystem_path IS NOT NULL")
        stats.already_populated = cur.fetchone()['count']
        print(f"Already populated: {stats.already_populated:,}")
        print()

        print("Phase 1: Extracting from MGnify biome hierarchies...")
        phase1_where_clause = "WHERE b.name LIKE 'root:%'"
        if not override_existing:
            phase1_where_clause = "WHERE s.gold_ecosystem_path IS NULL AND b.name LIKE 'root:%'"

        cur.execute(f"""
            SELECT
                s.id,
                s.external_id,
                b.name as biome_name,
                ARRAY(SELECT ds.name FROM data_sources ds WHERE ds.id = ANY(s.data_source_ids)) as data_sources
            FROM samples s
            JOIN sample_biomes sb ON s.id = sb.sample_id
            JOIN biomes b ON sb.biome_id = b.id
            {phase1_where_clause}
            ORDER BY s.id
        """)

        mgnify_batch = []
        processed_sample_ids = set()
        for row in cur:
            sample_id = row['id']
            processed_sample_ids.add(sample_id)

            gold_path = clean_mgnify_biome_path(row['biome_name'])
            if gold_path:
                mgnify_batch.append((
                    gold_path,
                    json.dumps({
                        'source': 'mgnify_biome',
                        'confidence': 'high',
                        'original_biome': row['biome_name'],
                        'mapped_at': datetime.now().isoformat()
                    }),
                    sample_id
                ))
                stats.mapped_from_mgnify += 1

                data_sources_str = ', '.join(row['data_sources']) if row['data_sources'] else ''
                stats.mapped_samples.append({
                    'sample_id': str(sample_id),
                    'external_id': row['external_id'] or '',
                    'data_sources': data_sources_str,
                    'gold_ecosystem_path': gold_path,
                    'source': 'mgnify_biome',
                    'confidence': 'high',
                    'original_biome': row['biome_name'],
                    'environment_biome': '',
                    'envo_text': '',
                    'envo_id': '',
                    'environmental_package': '',
                    'mixs_package': '',
                    'environment_feature': '',
                    'environment_material': '',
                    'combined_key': ''
                })

                ecosystem = gold_path.split(':')[0] if ':' in gold_path else gold_path
                stats.by_ecosystem[ecosystem] += 1

                if len(mgnify_batch) >= batch_size:
                    if not dry_run:
                        execute_values(
                            update_cur,
                            """
                            UPDATE samples SET
                                gold_ecosystem_path = data.path,
                                gold_ecosystem_metadata = data.meta::jsonb
                            FROM (VALUES %s) AS data(path, meta, id)
                            WHERE samples.id = data.id::uuid
                            """,
                            mgnify_batch
                        )
                        conn.commit()
                    print(f"  Processed {stats.mapped_from_mgnify:,} MGnify samples...")
                    mgnify_batch = []

        if mgnify_batch and not dry_run:
            execute_values(
                update_cur,
                """
                UPDATE samples SET
                    gold_ecosystem_path = data.path,
                    gold_ecosystem_metadata = data.meta::jsonb
                FROM (VALUES %s) AS data(path, meta, id)
                WHERE samples.id = data.id::uuid
                """,
                mgnify_batch
            )
            conn.commit()

        print(f"  Completed: {stats.mapped_from_mgnify:,} samples from MGnify biomes")
        print(f"  (Tracked {len(processed_sample_ids):,} processed sample IDs)")
        print()

        print("Phase 2: Mapping from ENVO/MIxS for remaining samples...")

        if processed_sample_ids:
            exclusion_list = ','.join(f"'{str(sid)}'" for sid in processed_sample_ids)
            exclusion_clause = f"AND s.id NOT IN ({exclusion_list})"
        else:
            exclusion_clause = ""

        phase2_where_clause = "WHERE 1=1"
        if not override_existing:
            phase2_where_clause = "WHERE s.gold_ecosystem_path IS NULL"

        cur.execute(f"""
            SELECT
                s.id,
                s.external_id,
                s.environment_biome,
                s.environmental_package,
                s.environment_feature,
                s.environment_material,
                ARRAY(SELECT ds.name FROM data_sources ds WHERE ds.id = ANY(s.data_source_ids)) as data_sources
            FROM samples s
            {phase2_where_clause}
              {exclusion_clause}
            ORDER BY s.id
        """)

        mapping_batch = []
        for row in cur:
            gold_path, source, confidence, envo_text, envo_id = map_to_gold(
                dict(row),
                ENVO_TO_GOLD,
                MIXS_TO_GOLD,
                COMBINED_TO_GOLD,
                priority_mode
            )

            if gold_path:
                mapping_batch.append((
                    gold_path,
                    json.dumps({
                        'source': source,
                        'confidence': confidence,
                        'mapped_at': datetime.now().isoformat()
                    }),
                    row['id']
                ))

                if source == 'envo_id':
                    stats.mapped_from_envo_id += 1
                elif source == 'combined_3field':
                    stats.mapped_from_combined_3field += 1
                elif source == 'combined_2field':
                    stats.mapped_from_combined_2field += 1
                elif source == 'envo_text':
                    stats.mapped_from_envo_text += 1
                elif source == 'mixs_package':
                    stats.mapped_from_mixs += 1
                elif source == 'environment_feature':
                    stats.mapped_from_feature += 1
                elif source == 'environment_material':
                    stats.mapped_from_material += 1

                combined_key = ''
                if source.startswith('combined'):
                    feature = row.get('environment_feature', '').lower().strip() if row.get('environment_feature') else ''
                    material = row.get('environment_material', '').lower().strip() if row.get('environment_material') else ''
                    package = row.get('environmental_package', '').lower().strip() if row.get('environmental_package') else ''
                    if source == 'combined_3field' and feature and material and package:
                        combined_key = f"{feature}|{material}|{package}"
                    elif source == 'combined_2field':
                        if feature and material:
                            combined_key = f"{feature}|{material}"
                        elif feature and package:
                            combined_key = f"{feature}|{package}"
                        elif material and package:
                            combined_key = f"{material}|{package}"

                data_sources_str = ', '.join(row['data_sources']) if row['data_sources'] else ''
                stats.mapped_samples.append({
                    'sample_id': str(row['id']),
                    'external_id': row['external_id'] or '',
                    'data_sources': data_sources_str,
                    'gold_ecosystem_path': gold_path,
                    'source': source,
                    'confidence': confidence,
                    'original_biome': '',
                    'environment_biome': row['environment_biome'] or '',
                    'envo_text': envo_text or '',
                    'envo_id': envo_id or '',
                    'environmental_package': row['environmental_package'] or '',
                    'mixs_package': row['environmental_package'] or '',
                    'environment_feature': row['environment_feature'] or '',
                    'environment_material': row['environment_material'] or '',
                    'combined_key': combined_key
                })

                ecosystem = gold_path.split(':')[0] if ':' in gold_path else gold_path
                stats.by_ecosystem[ecosystem] += 1

                if len(mapping_batch) >= batch_size:
                    if not dry_run:
                        execute_values(
                            update_cur,
                            """
                            UPDATE samples SET
                                gold_ecosystem_path = data.path,
                                gold_ecosystem_metadata = data.meta::jsonb
                            FROM (VALUES %s) AS data(path, meta, id)
                            WHERE samples.id = data.id::uuid
                            """,
                            mapping_batch
                        )
                        conn.commit()
                    total_mapped = (stats.mapped_from_envo_id + stats.mapped_from_envo_text +
                                  stats.mapped_from_mixs + stats.mapped_from_feature +
                                  stats.mapped_from_material)
                    print(f"  Processed {total_mapped:,} mapped samples...")
                    mapping_batch = []
            else:
                data_sources_str = ', '.join(row['data_sources']) if row['data_sources'] else ''
                stats.unmapped_samples.append({
                    'id': str(row['id']),
                    'external_id': row['external_id'] or '',
                    'data_sources': data_sources_str,
                    'environment_biome': row['environment_biome'] or '',
                    'environmental_package': row['environmental_package'] or '',
                    'environment_feature': row['environment_feature'] or '',
                    'environment_material': row['environment_material'] or '',
                })
                stats.unmapped += 1

        if mapping_batch and not dry_run:
            execute_values(
                update_cur,
                """
                UPDATE samples SET
                    gold_ecosystem_path = data.path,
                    gold_ecosystem_metadata = data.meta::jsonb
                FROM (VALUES %s) AS data(path, meta, id)
                WHERE samples.id = data.id::uuid
                """,
                mapping_batch
            )
            conn.commit()

        total_mapped = (stats.mapped_from_envo_id + stats.mapped_from_envo_text +
                       stats.mapped_from_mixs + stats.mapped_from_feature +
                       stats.mapped_from_material)
        print(f"  Completed: {total_mapped:,} samples from ENVO/MIxS mapping")
        print()

        if export_mapped and stats.mapped_samples:
            output_file = f"mapped_samples_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{priority_mode}.tsv"
            with open(output_file, 'w', newline='') as tsvfile:
                fieldnames = ['sample_id', 'external_id', 'data_sources', 'gold_ecosystem_path',
                            'source', 'confidence', 'original_biome', 'environment_biome', 'envo_text', 'envo_id',
                            'environmental_package', 'mixs_package', 'environment_feature', 'environment_material',
                            'combined_key']
                writer = csv.DictWriter(tsvfile, fieldnames=fieldnames, delimiter='\t')
                writer.writeheader()
                writer.writerows(stats.mapped_samples)
            print(f"Exported {len(stats.mapped_samples):,} mapped samples to: {output_file}")
            print()

        if export_unmapped and stats.unmapped_samples:
            output_file = f"unmapped_samples_{datetime.now().strftime('%Y%m%d_%H%M%S')}.tsv"
            with open(output_file, 'w', newline='') as tsvfile:
                fieldnames = ['id', 'external_id', 'data_sources', 'environment_biome',
                            'environmental_package', 'environment_feature', 'environment_material']
                writer = csv.DictWriter(tsvfile, fieldnames=fieldnames, delimiter='\t')
                writer.writeheader()
                writer.writerows(stats.unmapped_samples)
            print(f"Exported {len(stats.unmapped_samples):,} unmapped samples to: {output_file}")
            print()

    except Exception as e:
        print(f"\nError: {e}")
        conn.rollback()
        raise
    finally:
        stats.print_summary()
        cur.close()
        update_cur.close()
        conn.close()

    return stats


def main():
    parser = argparse.ArgumentParser(
        description='Backfill GOLD Ecosystem Classification for BGC Atlas samples'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Run without making database changes'
    )
    parser.add_argument(
        '--batch-size',
        type=int,
        default=1000,
        help='Number of records to process per batch (default: 1000)'
    )
    parser.add_argument(
        '--no-export-unmapped',
        action='store_true',
        help='Do not export unmapped samples to TSV'
    )
    parser.add_argument(
        '--no-export-mapped',
        action='store_true',
        help='Do not export mapped samples to TSV'
    )
    parser.add_argument(
        '--priority-mode',
        type=str,
        choices=['standard', 'feature-first', 'combined'],
        default='standard',
        help='Mapping priority mode: standard (ENVO text before feature/material), feature-first (feature/material before ENVO text), or combined (uses field combinations)'
    )
    parser.add_argument(
        '--override-existing',
        action='store_true',
        help='Override existing gold_ecosystem_path values (reprocess all samples)'
    )
    parser.add_argument(
        '--refresh-sample-mvs',
        action='store_true',
        help='After the backfill, REFRESH (CONCURRENTLY) the sample-facing MVs that '
             'depend on gold_ecosystem_path (%s). Use this as the post-load step '
             'after an MGnify load.' % ', '.join(SAMPLE_FACING_MVS)
    )

    args = parser.parse_args()

    try:
        backfill_gold_ecosystem(
            batch_size=args.batch_size,
            dry_run=args.dry_run,
            export_unmapped=not args.no_export_unmapped,
            export_mapped=not args.no_export_mapped,
            priority_mode=args.priority_mode,
            override_existing=args.override_existing
        )

        if args.refresh_sample_mvs:
            refresh_sample_facing_mvs(dry_run=args.dry_run)

        if args.dry_run:
            print("\nDRY RUN completed - no changes were made to the database")
        else:
            print("\nBackfill completed successfully!")

        return 0
    except KeyboardInterrupt:
        print("\n\nInterrupted by user")
        return 130
    except Exception as e:
        print(f"\nFailed: {e}")
        return 1


if __name__ == '__main__':
    sys.exit(main())
