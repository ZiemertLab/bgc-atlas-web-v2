"""Tests for the metalog ENVO -> GOLD crosswalk in scripts/backfill_gold_ecosystem.py,
loaded by path (it is a standalone script). Focus: the low-confidence bare
environment_feature / environment_material fallback, where a context-free word in
ENVO_TO_GOLD becomes a misannotation engine.
"""
import importlib.util
import pathlib

import pytest

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]


def _load_backfill():
    path = _REPO_ROOT / "scripts" / "backfill_gold_ecosystem.py"
    spec = importlib.util.spec_from_file_location("_backfill_gold_ecosystem", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


bf = _load_backfill()


def _classify(sample, mode="combined"):
    return bf.map_to_gold(sample, bf.ENVO_TO_GOLD, bf.MIXS_TO_GOLD, bf.COMBINED_TO_GOLD, mode)


# Guo_2014_Chinese_liquor_fermentation: pit mud from a baijiu cellar. Mapping bare
# "pit" to mining would file the whole study under Mining.
GUO_2014_SAMPLE = {
    "environment_biome": "anthropogenic terrestrial biome",
    "environment_feature": "pit",
    "environment_material": "mud",
    "environmental_package": None,
}


def test_fermentation_pit_mud_is_not_mining():
    path, _source, _conf, _t, _i = _classify(GUO_2014_SAMPLE)
    assert path != "Engineered:Mining"


def test_fermentation_pit_mud_resolves_to_food_production():
    path, source, conf, _t, _i = _classify(GUO_2014_SAMPLE)
    assert path == "Engineered:Food production:Fermented beverages"
    assert source == "combined_2field"
    assert conf == "medium-high"


@pytest.mark.parametrize("token", sorted(bf.AMBIGUOUS_BARE_TOKENS))
def test_ambiguous_tokens_never_classify_from_bare_feature(token):
    path, source, _c, _t, _i = _classify({"environment_feature": token})
    assert path is None, f"bare feature {token!r} classified as {path!r} via {source}"


@pytest.mark.parametrize("token", sorted(bf.AMBIGUOUS_BARE_TOKENS))
def test_ambiguous_tokens_never_classify_from_bare_material(token):
    path, source, _c, _t, _i = _classify({"environment_material": token})
    assert path is None, f"bare material {token!r} classified as {path!r} via {source}"


@pytest.mark.parametrize("mode", ["combined", "feature-first", "standard"])
def test_deny_set_applies_in_every_priority_mode(mode):
    """The fallback appears in all three priority ladders."""
    path, _s, _c, _t, _i = _classify({"environment_feature": "pit"}, mode=mode)
    assert path is None


def test_ambiguous_tokens_still_work_as_high_confidence_envo_text():
    """A denied word as the curated environment_biome term is still a real ENVO match."""
    path, source, _c, _t, _i = _classify({"environment_biome": "farm"}, mode="standard")
    assert path == "Environmental:Terrestrial:Agricultural field"
    assert source == "envo_text"


def test_generic_looking_tokens_measured_harmless_are_not_denied():
    """"mine"/"well"/"rock"/"oil" look generic but map correctly on this corpus (e.g.
    EMP500 mine/rock samples); denying them falls through to something worse."""
    for token in ("mine", "well", "rock", "oil"):
        assert token not in bf.AMBIGUOUS_BARE_TOKENS
    path, _s, _c, _t, _i = _classify(
        {"environment_biome": "dense settlement biome",
         "environment_feature": "mine", "environment_material": "rock"})
    assert path == "Environmental:Terrestrial:Geologic:Mine"


def test_unambiguous_features_are_unaffected():
    for feature, expected in [
        ("peatland", "Environmental:Terrestrial:Soil:Peat"),
        ("wastewater treatment plant", "Engineered:Wastewater"),
        ("rhizoplane", "Host-associated:Plants:Roots:Rhizoplane"),
        ("acid mine drainage", "Engineered:Wastewater:Industrial wastewater:Acid mine drainage"),
    ]:
        path, _s, _c, _t, _i = _classify({"environment_feature": feature})
        assert path == expected, feature


def test_catchment_basin_beats_a_collection_level_soil_package():
    """Rovira_2019_farm used package="soil" for every sample; a collection-level
    package must not outrank the sample's own material."""
    wastewater = {"environment_biome": "feedlot", "environment_feature": "drainage basin",
                  "environment_material": "waste water", "environmental_package": "soil"}
    path, source, _c, _t, _i = _classify(wastewater)
    assert path == "Engineered:Wastewater"
    assert source == "combined_2field"

    soil = {"environment_biome": "feedlot", "environment_feature": "field soil",
            "environment_material": "soil", "environmental_package": "soil"}
    path, _s, _c, _t, _i = _classify(soil)
    assert path.startswith("Environmental:Terrestrial:Soil")


# Real (feature, material, package) triples a coarser package/biome would bury.
_BURIED_ENGINEERED_CASES = [
    ("sewage plant", "sludge", "water", "Engineered:Wastewater:Sludge", "Ciesielski_2019_wastewater"),
    # GOLD models the material taken out of a treatment plant, not the plant.
    ("wastewater treatment plant", "activated sludge", "misc",
     "Engineered:Wastewater:Activated Sludge", "Wang_2018 + 6 more"),
    ("wastewater treatment plant", "sewage", "misc",
     "Engineered:Wastewater:Sewage", "Brinch_2020_sewage_copenhagen"),
    ("wastewater treatment plant", "waste water", "misc",
     "Engineered:Wastewater", "Ng_2019_wastewater"),
    ("sewage plant", "biosolids", "misc",
     "Engineered:Wastewater:Sludge", "Bengtsson-Palme_2016_sewage"),
    # Only the parent: compost and tailings leach too.
    ("leachate", "liquid water", "water", "Engineered:Solid waste", "JGI_landfill_Ontario"),
    ("waste water", "sediment", "sediment", "Engineered:Wastewater", "Chu_2017_sludge"),
    ("waste water", "waste water", "water", "Engineered:Wastewater", "Chu_2017_sludge"),
    ("city", "skin environment", "host-associated", "Engineered:Built environment:City", "Kang_2018_subway"),
    ("hospital", "waste water", "misc", "Engineered:Wastewater", "Rowe_2017 + Perry_2019"),
    ("shower fixture", "biofilm", "water", "Engineered:Built environment", "Soto-Giron_2016_showers"),
    ("animal aquaculture process", "liquid water", "water",
     "Engineered:Artificial ecosystem:Aquaculture", "Ramachandran_2018_oyster"),
    ("drainage basin", "waste water", "soil", "Engineered:Wastewater", "Rovira_2019_farm"),
]


@pytest.mark.parametrize("feature,material,package,expected,study", _BURIED_ENGINEERED_CASES,
                         ids=[c[4] for c in _BURIED_ENGINEERED_CASES])
def test_engineered_feature_beats_a_coarser_package(feature, material, package, expected, study):
    path, source, _c, _t, _i = _classify({
        "environment_feature": feature, "environment_material": material,
        "environmental_package": package})
    assert path == expected, f"{study}: {feature}|{material}|{package}"
    assert source in ("combined_2field", "combined_3field")


def test_studies_that_only_SOUND_engineered_are_left_alone():
    """These studies sound engineered but their ENVO fields describe environmental samples."""
    # Glasl_2020_coral_reef: reef seawater. The :Marine:Pelagic zone leaf comes from the
    # aquatic-subtype backfill, so assert the branch.
    path, _s, _c, _t, _i = _classify({
        "environment_biome": "marine coral reef biome", "environment_feature": "sea water",
        "environment_material": "sea water", "environmental_package": "water"})
    assert path.startswith("Environmental:Aquatic")

    # Jung_2018_food: the ENVO fields say plant matter, and that is what it is
    path, _s, _c, _t, _i = _classify({
        "environment_feature": "plant matter", "environment_material": "plant matter",
        "environmental_package": "misc"})
    assert path == "Host-associated:Plants"


def test_engineered_mining_is_never_emitted():
    """Engineered:Mining is not a GOLD path."""
    all_targets = (set(bf.ENVO_TO_GOLD.values()) | set(bf.COMBINED_TO_GOLD.values())
                   | set(bf.MIXS_TO_GOLD.values()))
    assert "Engineered:Mining" not in all_targets


def test_a_mine_is_a_geologic_setting():
    """Shaffer_2021_EMP500: GOLD files a mine under Terrestrial:Geologic."""
    path, _s, _c, _t, _i = _classify({
        "environment_biome": "dense settlement biome", "environment_feature": "mine",
        "environment_material": "rock", "environmental_package": "misc"})
    assert path == "Environmental:Terrestrial:Geologic:Mine"


def test_a_mining_bioreactor_is_a_bioreactor():
    """Watts_2019_bioreactor: the sequenced material is the reactor consortium."""
    path, source, _c, _t, _i = _classify({
        "environment_biome": "terrestrial mining", "environment_feature": "terrestrial mining",
        "environment_material": "planktonic material", "environmental_package": "misc"})
    assert path == "Engineered:Bioreactor"
    assert source == "combined_2field"


def test_deny_set_is_narrow():
    assert len(bf.AMBIGUOUS_BARE_TOKENS) <= 12
    assert bf.AMBIGUOUS_BARE_TOKENS <= set(bf.ENVO_TO_GOLD), \
        "every denied token must actually be an ENVO_TO_GOLD key, else the guard is dead code"
