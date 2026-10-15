import pytest

from scripts.populator.core.gold_normalize import normalize_gold_ecosystem_path as norm


@pytest.mark.parametrize("src,expected", [
    ("Environmental:Terrestrial:Forest:Soil",
     "Environmental:Terrestrial:Soil:Forest soil"),
    ("Environmental:Terrestrial:Forest:Tropical",
     "Environmental:Terrestrial:Soil:Tropical forest"),
    ("Environmental:Terrestrial:Forest:Temperate",
     "Environmental:Terrestrial:Soil:Forest soil"),
    ("Environmental:Terrestrial:Forest",
     "Environmental:Terrestrial:Soil:Forest soil"),
    ("Environmental:Terrestrial:Soil:Tropical rainforest",
     "Environmental:Terrestrial:Soil:Tropical forest"),
    ("Environmental:Terrestrial:Soil:Agricultural",
     "Environmental:Terrestrial:Soil:Agricultural land"),
    ("Environmental:Terrestrial:Soil:Oil-contaminated",
     "Environmental:Terrestrial:Soil:Contaminated"),
    ("Environmental:Terrestrial:Agricultural",
     "Environmental:Terrestrial:Agricultural field"),
    ("Environmental:Aquatic:Marine:Pelagic",
     "Environmental:Aquatic:Marine:Pelagic zone"),
    ("Environmental:Aquatic:Lentic:Brackish",
     "Environmental:Aquatic:Freshwater:Lentic"),
    ("Environmental:Aquatic:Freshwater:Stream",
     "Environmental:Aquatic:Freshwater:Creek"),
    ("Environmental:Aquatic:Non-marine Saline and Alkaline:Salt crystallizer pond",
     "Environmental:Aquatic:Non-marine Saline and Alkaline:Salt crystallizer ponds"),
    ("Host-associated:Animals", "Host-associated"),
    ("Host-associated:Plants:Root", "Host-associated:Plants:Roots"),
    ("Host-associated:Protozoa", "Host-associated:Protists"),
    # GOLD nests Rhizosphere/Rhizoplane as siblings under Roots
    ("Host-associated:Plants:Rhizosphere",
     "Host-associated:Plants:Roots:Rhizosphere"),
    ("Host-associated:Plants:Rhizosphere:Soil",
     "Host-associated:Plants:Roots:Rhizosphere:Soil"),
    ("Host-associated:Plants:Rhizoplane",
     "Host-associated:Plants:Roots:Rhizoplane"),
    ("Host-associated:Plants:Rhizosphere:Rhizoplane:Endophytes",
     "Host-associated:Plants:Roots:Rhizoplane:Endophytes"),
    ("Host-associated:Plants:Phylloplane",
     "Host-associated:Plants:Phyllosphere:Phylloplane/Leaf"),
    ("Host-associated:Plants:Phyllosphere:Phylloplane",
     "Host-associated:Plants:Phyllosphere:Phylloplane/Leaf"),
    ("Host-associated:Cnidaria", "Host-associated:Invertebrates:Cnidaria"),
    ("Environmental:Terrestrial:Wetland",
     "Environmental:Terrestrial:Soil:Wetlands"),
    ("Engineered:Waste management:Compost", "Engineered:Solid waste:Composting"),
    ("Engineered:Biogas plant", "Engineered:Bioreactor:Anaerobic:Biogas"),
    ("Engineered:Biogas plant:Wet fermentation",
     "Engineered:Bioreactor:Anaerobic:Biogas"),
    ("Engineered:Wastewater:Activated sludge", "Engineered:Wastewater:Activated Sludge"),
    # casing fix plus retirement of "Treatment plant" (re-homes under Wastewater)
    ("Engineered:Wastewater:Treatment plant:Activated sludge",
     "Engineered:Wastewater:Activated Sludge"),
    ("Engineered:Lab Synthesis:Genetic cross", "Engineered:Lab synthesis:Genetic cross"),
    ("Host-associated:Mammals:Gastrointestinal tract",
     "Host-associated:Mammals:Digestive system"),
    ("Host-associated:Mammals:Gastrointestinal tract:Intestine:Fecal",
     "Host-associated:Mammals:Digestive system:Large intestine:Fecal"),
    ("Host-associated:Human:Digestive system:Intestine",
     "Host-associated:Human:Digestive system:Large intestine"),
    ("Host-associated:Human:Digestive system:Oral:tongue dorsum",
     "Host-associated:Human:Digestive system:Oral cavity:Tongue dorsum"),
])
def test_rules_rewrite(src, expected):
    assert norm(src) == expected


@pytest.mark.parametrize("src", [
    "Host-associated:Fish:Digestive system:Intestine",
    # "Human"/"Insecta" kept: GOLD's ": " names would collide with ':' storage
    "Host-associated:Human:Skin",
    "Host-associated:Insecta:Digestive system",
    # bare Arthropoda is not confidently a single GOLD subcategory
    "Host-associated:Arthropoda:Digestive system",
])
def test_delimiter_safe_and_ambiguous_left(src):
    assert norm(src) == src


@pytest.mark.parametrize("src,expected", [
    ("Host-associated:Plants:Root:Tip", "Host-associated:Plants:Roots:Tip"),
    ("Host-associated:Plants:Rhizoplane:Endophyte",
     "Host-associated:Plants:Roots:Rhizoplane:Endophyte"),
    ("Host-associated:Cnidaria:Coral", "Host-associated:Invertebrates:Cnidaria:Coral"),
])
def test_children_preserved(src, expected):
    assert norm(src) == expected


@pytest.mark.parametrize("src", [
    None,
    "",
    "Environmental:Terrestrial:Soil:Forest soil",
    "Environmental:Terrestrial:Soil:Sand",
    "Environmental:Aquatic:Marine:Oceanic",
    "Environmental:Aquatic:Marine:Pelagic zone",
    "Host-associated:Plants:Roots:Rhizosphere",
    "Host-associated:Plants:Phyllosphere:Anthosphere",
    "Host-associated:Invertebrates:Cnidaria",
    "Engineered:Solid waste:Composting",
    "Engineered:Wastewater:Activated Sludge",
    # MGnify's "root:Mixed" is not GOLD but says the sample spans biomes, which is
    # not the same as NULL.
    "Mixed",
])
def test_noop_paths(src):
    assert norm(src) == src


@pytest.mark.parametrize("src", [
    "Environmental:Terrestrial:Forest:Soil",
    "Environmental:Aquatic:Marine:Pelagic",
    "Host-associated:Plants:Rhizoplane:X",
    "Host-associated:Plants:Rhizosphere:Rhizoplane:Endophytes",
    "Host-associated:Cnidaria",
    "Engineered:Biogas plant",
    "Engineered:Wastewater:Activated sludge",
    "Environmental:Aquatic:Lentic:Brackish",
])
def test_idempotent(src):
    once = norm(src)
    assert norm(once) == once


_RETIRED_INVENTED = [
    # fallback to the valid parent rather than minting an Engineered:WWTP branch
    ("Engineered:Wastewater:Treatment plant", "Engineered:Wastewater"),
    # Engineered:WWTP:Activated Sludge is not a GOLD path either
    ("Engineered:Wastewater:Treatment plant:Activated Sludge",
     "Engineered:Wastewater:Activated Sludge"),
    # GOLD's Environmental AMD path is under Groundwater, wrong for surface sediments
    ("Environmental:Aquatic:Contaminated:Acid mine drainage",
     "Engineered:Wastewater:Industrial wastewater:Acid mine drainage"),
    ("Engineered:Oil and gas production",
     "Environmental:Terrestrial:Deep subsurface:Fracking water"),
    ("Environmental:Terrestrial:Peat", "Environmental:Terrestrial:Soil:Peat"),
]


@pytest.mark.parametrize("old,new", _RETIRED_INVENTED)
def test_invented_categories_normalize_to_real_gold(old, new):
    assert norm(old) == new


@pytest.mark.parametrize("old,new", _RETIRED_INVENTED)
def test_retired_rewrites_are_idempotent(old, new):
    assert norm(new) == new


@pytest.mark.parametrize("old,new", _RETIRED_INVENTED)
def test_every_retirement_target_is_a_real_gold_path(old, new):
    """The replacement must itself exist in GOLDs5levelEcosystemClassification."""
    from scripts.populator.adapters.gtdb_ecosystem import _iter_xlsx_paths, GOLD_XLSX_PATH
    assert new in set(_iter_xlsx_paths(GOLD_XLSX_PATH)), new


def test_children_are_preserved_under_a_retirement_rewrite():
    assert (norm("Environmental:Terrestrial:Peat:Bog")
            == "Environmental:Terrestrial:Soil:Peat:Bog")


# Non-GOLD paths found on loaded samples (MGnify biome lineages, older GOLD vocabulary in
# the GEM and SPIRE catalogs). Each must normalize to a real GOLD path.
_LOADED_NON_GOLD = [
    "Host-associated:Human:Digestive system:Oral:Saliva",
    "Host-associated:Human:Digestive system:Oral:Subgingival plaque",
    "Host-associated:Human:Digestive system:Oral:Supragingival plaque",
    "Host-associated:Human:Digestive system:Oral:Tongue dorsum",
    "Host-associated:Human:Digestive system:Oral:Hard palate",
    "Host-associated:Human:Digestive system:Hindgut",
    "Host-associated:Human:Digestive system:Hindgut:Rectum",
    "Host-associated:Human:Excretory system:Urethra:Urine",
    "Host-associated:Human:Respiratory system:Pulmonary system:Lung",
    "Host-associated:Human:Respiratory system:Nasopharyngeal",
    "Host-associated:Human:Skin:Naris",
    "Host-associated:Mammals:Digestive system:Fecal",
    "Host-associated:Mammals:Digestive system:Midgut",
    "Host-associated:Birds:Digestive system:Digestive tube",
    "Host-associated:Birds:Digestive system:Digestive tube:Cecum",
    "Host-associated:Birds:Digestive system:Fecal",
    "Host-associated:Birds:Skin",
    "Host-associated:Fish:Digestive system:Large intestine",
    "Host-associated:Fish:Digestive system:Large intestine:Fecal",
    "Host-associated:Fish:Skin",
    "Host-associated:Amphibia:Digestive system:Large intestine:Fecal",
    "Host-associated:Mollusca:Digestive system:Large intestine:Fecal",
    "Host-associated:Invertebrates:Cnidaria:Skin",
    "Host-associated:Insecta:Digestive system:Large intestine",
    "Host-associated:Insecta:Digestive system:Large intestine:Fecal",
    "Host-associated:Animal",
    "Host-associated:Animal:Digestive system",
    "Host-associated:Animal:Digestive system:Fecal",
    "Host-associated:Arthropoda:Ant dump",
    "Host-associated:Arthropoda:Symbiotic fungal gardens and galleries",
    "Host-associated:Plants:Roots:Rhizoplane:Soil",
    "Host-associated:Plants:Phyllosphere:Phylloplane/Leaf:Epiphytes",
    "Environmental:Aquatic:Estuary",
    "Environmental:Aquatic:Estuary:Sediment",
    "Environmental:Aquatic:Marine:Brackish",
    "Environmental:Aquatic:Marine:Oil-contaminated sediment",
    "Environmental:Aquatic:Freshwater:Lentic:Brackish",
    "Environmental:Aquatic:Freshwater:Lotic:Low land river systems",
    "Environmental:Aquatic:Freshwater:Lotic:Sediment",
    "Environmental:Aquatic:Freshwater:Lotic:Acidic",
    "Environmental:Aquatic:Freshwater:Lotic:Mid stream",
    "Environmental:Aquatic:Freshwater:Groundwater:Biofilm",
    "Environmental:Aquatic:Non-marine Saline and Alkaline:Sediment",
    "Environmental:Terrestrial:Soil:Wetlands:Freshwater",
    "Environmental:Terrestrial:Wetland:Freshwater",
    "Engineered:Wastewater:Water and sludge",
    "Engineered:Wastewater:Nutrient removal:Biological phosphorus removal:Activated Sludge",
    "Engineered:Bioreactor:Wastewater:Activated Sludge",
    "Engineered:Bioreactor:Aerobic:Activated Sludge",
    "Engineered:Sewage treatment plant:Activated Sludge",
    "Engineered:WWTP:Activated Sludge",
    "Engineered:Bioreactor:Continuous culture:Marine sediment inoculum:Wadden Sea-Germany",
    "Engineered:Bioreactor:Continuous culture:Marine intertidal flat sediment inoculum:"
    "Wadden Sea-Germany",
    "Engineered:Bioreactor:Anaerobic:Biogas:Wet fermentation",
    "Engineered:Solid waste:Composting:Bioreactor",
]


@pytest.fixture(scope="module")
def gold():
    from scripts.populator.adapters.gtdb_ecosystem import gold_prefixes
    return gold_prefixes()


@pytest.mark.parametrize("path", _LOADED_NON_GOLD)
def test_loaded_non_gold_paths_normalize_to_gold(gold, path):
    assert norm(path) in gold


def test_every_rule_and_truncation_target_is_gold(gold):
    from scripts.populator.core.gold_normalize import _RULES, _TRUNCATE
    for _match, repl in _RULES + _TRUNCATE:
        assert norm(":".join(repl)) in gold, repl


@pytest.mark.parametrize("path,expected", [
    ("Engineered:Wastewater:Activated sludge", "Engineered:Wastewater:Activated Sludge"),
    ("Engineered:WWTP:Activated Sludge", "Engineered:WWTP:Activated sludge"),
    ("Engineered:Sewage treatment plant:Activated Sludge",
     "Engineered:Sewage treatment plant:Activated sludge"),
])
def test_activated_sludge_casing_depends_on_branch(path, expected):
    assert norm(path) == expected


def test_human_oral_merges_into_oral_cavity():
    assert norm("Host-associated:Human:Digestive system:Oral") == \
        "Host-associated:Human:Digestive system:Oral cavity"
    assert norm("Host-associated:Human:Digestive system:Oral:Saliva") == \
        "Host-associated:Human:Digestive system:Oral cavity:Saliva"
