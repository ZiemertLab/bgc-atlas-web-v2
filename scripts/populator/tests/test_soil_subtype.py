"""Tests for the conservative soil-habitat -> GOLD subtype crosswalk (adapters.soil_subtype)."""
import pytest

from scripts.populator.adapters.soil_subtype import soil_subtype_for


@pytest.mark.parametrize("feature,expected", [
    ("Forest soil", "Forest soil"),
    ("Tropical forest soil", "Forest soil"),
    ("forested area", "Forest soil"),
    ("agricultural field", "Agricultural land"),
    ("Agricultural soil", "Agricultural land"),
    ("Wheat field", "Agricultural land"),
    ("Arctic peat soil", "Peat"),
    ("Peatlands soil", "Peat"),
    ("permafrost", "Permafrost"),
    ("tundra", "Tundra"),
    ("Glacier forefield soil", "Glacier"),
    ("grassland soil", "Grasslands"),
    ("Natural and restored wetlands", "Wetlands"),
    ("greenhouse soil", "Greenhouse"),
    ("contaminated soil", "Contaminated"),
    ("Desert sand dune", "Desert"),
    ("Loam", "Loam"),
    # biological soil crust (from SMAG BioSample isolation_source)
    ("non-moss soil biological crust", "Biocrust"),
    ("moss biological soil crust", "Biocrust"),
    ("soil below hypolithic moss crust", "Biocrust"),
    ("desert soil", "Desert"),
    ("contaminated soil", "Contaminated"),
])
def test_mapped(feature, expected):
    assert soil_subtype_for(feature) == expected


@pytest.mark.parametrize("feature", [
    "soil", "Soil", "surface soil", "terrestrial soil", "field soil", "field",
    "missing", "not provided", "other", "plain", "valley",
    "Wet heath", "Dry heath", "Juniper scrub", "Parks",
    "Atlantic salt meadows", "Inland salt meadows", "Salicornia mud",
    "Salt marshes and salt meadows", "rhizosphere", "corn rhizosphere", "compost",
    "pollution", "Potential pollution",   # noun, not "contaminated"/"polluted"
    None, "", "   ",
])
def test_left_generic(feature):
    assert soil_subtype_for(feature) is None


def test_guards():
    assert soil_subtype_for("deforested area") is None
    assert soil_subtype_for("groundwater sand") is None


def test_ordering_peat_before_forest():
    # a bog forest is peat-dominated
    assert soil_subtype_for("bog forest soil") == "Peat"
