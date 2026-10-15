"""Tests for the branch-aware aquatic habitat -> GOLD subtype crosswalk (adapters.aquatic_subtype)."""
import pytest

from scripts.populator.adapters.aquatic_subtype import aquatic_deepen

M = "Environmental:Aquatic:Marine"
F = "Environmental:Aquatic:Freshwater"
A = "Environmental:Aquatic"


@pytest.mark.parametrize("current,feature,expected", [
    # Marine -> zone
    (M, "pelagic", f"{M}:Pelagic zone"),
    (M, "seawater", f"{M}:Pelagic zone"),
    (M, "coastal", f"{M}:Coastal"),
    (M, "deep ocean", f"{M}:Oceanic"),
    (M, "aphotic zone", f"{M}:Oceanic:Aphotic zone"),
    (M, "marine sediment", f"{M}:Sediment"),
    (M, "hydrothermal vent", f"{M}:Hydrothermal vents"),
    (M, "estuarine", f"{M}:Intertidal zone:Estuary"),   # level 5
    (M, "salt marsh", f"{M}:Intertidal zone:Salt marsh"),  # level 5
    (M, "ocean", f"{M}:Oceanic"),
    (M, "surface water layer (envo:00002042)", f"{M}:Pelagic zone"),
    (M, "deep chlorophyll maximum layer", f"{M}:Oceanic:Photic zone"),
    (M, "ocean surface water", f"{M}:Pelagic zone"),
    # Freshwater -> subtype
    (F, "freshwater lake", f"{F}:Lake"),
    (F, "freshwater lake sediment", f"{F}:Lake:Sediment"),
    (F, "groundwater", f"{F}:Groundwater"),
    (F, "peatland", f"{F}:Wetlands"),
    (F, "river water", f"{F}:River"),
    (F, "pond", f"{F}:Pond"),
    # bare Aquatic -> unambiguous branch only
    (A, "saline lake", f"{A}:Non-marine Saline and Alkaline:Saline lake"),
    (A, "hot spring", f"{A}:Thermal springs:Hot (42-90C)"),
    (A, "river water", f"{A}:Freshwater:River"),
    (A, "sea", f"{A}:Marine:Pelagic zone"),
    (A, "estuary", f"{A}:Marine:Intertidal zone:Estuary"),
])
def test_deepened(current, feature, expected):
    assert aquatic_deepen(current, feature) == expected


@pytest.mark.parametrize("current,feature", [
    (M, "marine"), (M, "microbial feature [envo:00002150]"), (M, "aqueous"),
    (F, "freshwater"), (F, "fresh water"), (F, "water"), (F, "watershed"),
    (A, "aquatic"), (A, "water body"), (A, "surface water"), (A, "animal host"),
    (M, None), (F, ""), (A, "   "),
])
def test_left_generic(current, feature):
    assert aquatic_deepen(current, feature) is None


def test_unhandled_branch_returns_none():
    assert aquatic_deepen("Environmental:Aquatic:Marine:Pelagic zone", "pelagic") is None
    assert aquatic_deepen("Environmental:Terrestrial:Soil", "forest") is None


def test_marine_specific_before_general():
    # marine sediment beats bare, estuary beats generic
    assert aquatic_deepen(M, "deep-sea sediment") == f"{M}:Sediment"
    assert aquatic_deepen(F, "lake sediment") == f"{F}:Lake:Sediment"
