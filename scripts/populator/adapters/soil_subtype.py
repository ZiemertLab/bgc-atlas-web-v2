"""Conservative crosswalk from free-text soil habitat to a GOLD level-4 soil subtype, for
samples stuck at ``Environmental:Terrestrial:Soil``. Only unambiguous habitats are mapped;
every target already exists in the DB.
"""
from typing import Optional

# (keywords, subtype, excludes); first match wins, so specific/wetter classes come first.
_RULES = [
    (("permafrost",),                                   "Permafrost",       ()),
    (("tundra",),                                       "Tundra",           ()),
    (("peat", "peatland", "bog", "fen ", " fen", "mire", "muskeg"),
                                                        "Peat",             ()),
    (("glacier", "glacial", "moraine", "forefield"),    "Glacier",          ()),
    (("mangrove",),                                     "Mangrove soil",    ()),
    (("biocrust", "soil crust", "biological crust", "biological soil crust",
      "moss crust", "hypolithic"),                      "Biocrust",         ()),
    (("desert",),                                       "Desert",           ()),
    (("agricultur", "arable", "cropland", "crop land", "farmland", "farm soil",
      "paddy", "rice field", "wheat field", "maize field", "corn field", "cultivated",
      "plantation", "orchard", "vineyard", "tilled"),  "Agricultural land", ()),
    (("greenhouse",),                                   "Greenhouse",       ()),
    (("grassland", "prairie", "pasture", "steppe", "savanna", "savannah"),
                                                        "Grasslands",       ()),
    (("forest", "forested", "woodland", "taiga", "rainforest"),
                                                        "Forest soil",      ("deforest",)),
    (("wetland", "swamp", "floodplain", "flood plain"), "Wetlands",         ("salt",)),
    (("contaminated", "polluted", "hydrocarbon-contaminat", "oil-contaminat", "heavy metal"),
                                                        "Contaminated",     ()),
    (("shrubland",),                                    "Shrubland",        ()),
    (("garden soil", "garden ", "botanical garden"),    "Garden",           ()),
    (("loam",),                                         "Loam",             ()),
    (("clay soil", " clay"),                            "Clay",             ()),
    (("sand",),                                         "Sand",             ("groundwater", "beach",
                                                                             "sandstone", "marine",
                                                                             "sea ", "river sand",
                                                                             "filter")),
]


def soil_subtype_for(feature: Optional[str]) -> Optional[str]:
    if not feature:
        return None
    f = feature.strip().lower()
    if not f:
        return None
    for keywords, subtype, excludes in _RULES:
        if any(x in f for x in excludes):
            continue
        if any(k in f for k in keywords):
            return subtype
    return None
