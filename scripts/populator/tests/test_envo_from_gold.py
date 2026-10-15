"""Tests for deriving the ENVO triad from a GOLD ecosystem path."""
from scripts.populator.adapters.envo_from_gold import gold_to_envo


def test_marine_and_sediment_longest_prefix():
    assert gold_to_envo("Environmental:Aquatic:Marine")["environment_material"] == "sea water"
    assert gold_to_envo("Environmental:Aquatic:Marine:Sediment")["environment_material"] == "marine sediment"


def test_source_specific_biomes():
    assert gold_to_envo("Environmental:Terrestrial:Soil:Forest soil") == {
        "environment_biome": "forest biome", "environment_feature": "Forest soil",
        "environment_material": "forest soil"}
    assert gold_to_envo("Environmental:Aquatic:Non-marine Saline and Alkaline:Saline lake")["environment_biome"] == "saline water biome"
    assert gold_to_envo("Environmental:Aquatic:Thermal springs:Hot (42-90C)")["environment_biome"] == "thermal spring biome"
    assert gold_to_envo("Environmental:Terrestrial:Soil:Wetlands")["environment_biome"] == "wetland biome"


def test_host_and_engineered():
    assert gold_to_envo("Host-associated:Human:Digestive system:Large intestine:Fecal")["environment_material"] == "feces"
    assert gold_to_envo("Host-associated:Plants:Rhizosphere")["environment_biome"] == "plant-associated habitat"
    assert gold_to_envo("Engineered:Wastewater")["environment_material"] == "wastewater"


def test_feature_is_leaf():
    assert gold_to_envo("Environmental:Aquatic:Freshwater:Lake")["environment_feature"] == "Lake"


def test_none_and_unmatched():
    assert gold_to_envo(None) is None
    assert gold_to_envo("") is None
