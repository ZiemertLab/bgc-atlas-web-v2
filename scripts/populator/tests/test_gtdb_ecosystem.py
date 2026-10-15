"""Tests for the shared GTDB ecosystem adapter. Integration tests read the real
committed TSVs; no DB."""
import pathlib

import pytest

from scripts.populator.adapters.gtdb_ecosystem import (
    GTDB_SOURCE_UUID,
    GOLD_COLUMNS,
    MADIN_COLUMNS,
    MADIN_TRAIT_KEYS,
    RULES,
    MADIN_RULES,
    load_gold_biosample_ecosystem,
    load_madin_species_traits,
    iso_classify,
    madin_gold,
    norm_gold_naming,
    nearest,
    ecosystem_for,
    own_metadata_path,
    madin_traits_for,
    gold_prefixes,
    _iter_xlsx_paths,
    _curated_paths,
    GOLD_XLSX_PATH,
)
from scripts.populator.adapters.envo_from_gold import gold_to_envo

_VALID_PREFIXES = ("Environmental", "Host-associated", "Engineered")


def _write(path, lines):
    path.write_text("\n".join(lines) + "\n")
    return path


def test_provenance_constants():
    assert GTDB_SOURCE_UUID == "eb473234-fae6-5fa1-8a99-8014e567fd3f"
    assert GOLD_COLUMNS == ("ncbi_biosample", "gold_ecosystem_path")
    assert MADIN_COLUMNS[0] == "species" and MADIN_COLUMNS[1] == "isolation_source"
    assert MADIN_TRAIT_KEYS["metabolism"] == "oxygen_metabolism"
    assert MADIN_TRAIT_KEYS["optimum_tmp"] == "optimum_temperature"


def test_iso_classify_required_cases():
    assert iso_classify("soil") == "Environmental:Terrestrial:Soil"
    assert iso_classify("blood") == "Host-associated:Human:Circulatory system"
    assert iso_classify("feces (bos taurus)") == \
        "Host-associated:Mammals:Digestive system:Large intestine"
    assert iso_classify("chicken") == "Host-associated:Birds"
    assert iso_classify("not known") is None


def test_iso_classify_junk_and_empty_are_none():
    for junk in ("", "  ", "NA", "n/a", "unknown", "not provided", "missing", None):
        assert iso_classify(junk) is None


def test_iso_classify_animal_retarget_human_to_mammals():
    assert iso_classify("cow dung").startswith("Host-associated:Mammals")
    assert iso_classify("human stool") == \
        "Host-associated:Human:Digestive system:Large intestine"


def test_iso_classify_every_output_is_valid_gold():
    samples = [
        "marine sediment", "seawater", "hot spring water", "freshwater lake", "river water",
        "groundwater", "rhizosphere soil", "plant leaf", "forest soil", "agricultural soil",
        "grassland", "desert sand", "peat bog", "compost", "activated sludge", "bioreactor",
        "cheese", "raw beef", "hospital surface", "blood culture", "cerebrospinal fluid",
        "stool sample", "saliva", "sputum", "urine", "vaginal swab", "skin swab",
        "chicken gut", "mouse feces", "coral tissue", "sponge",
    ]
    for s in samples:
        g = iso_classify(s)
        if g is not None:
            assert g.startswith(_VALID_PREFIXES), (s, g)
            assert nearest(g) == g, (s, g)


def test_madin_gold_required_cases():
    # endotherm host is not taxon-confirmed, so generic Host-associated (not Mammals).
    assert madin_gold("host_animal_endotherm_intestinal") == "Host-associated"
    assert madin_gold("host_animal_endotherm") == "Host-associated"
    assert madin_gold("host_plant_root") == "Host-associated:Plants:Roots"
    assert madin_gold("water_marine") == "Environmental:Aquatic:Marine"
    assert madin_gold("soil_forest") == "Environmental:Terrestrial:Soil:Forest soil"


def test_madin_gold_endotherm_never_claims_mammals():
    variants = [
        "host_animal_endotherm", "host_animal_endotherm_intestinal",
        "host_animal_endotherm_feces", "host_animal_endotherm_oral",
        "host_animal_endotherm_rumen", "host_animal_endotherm_nasopharyngeal",
        "host_animal_endotherm_blood", "host_animal_endotherm_vagina",
        "host_animal_endotherm_surface", "host_animal_endotherm_intratissue",
    ]
    for cat in variants:
        assert madin_gold(cat) == "Host-associated", cat


def test_madin_gold_unknown_and_empty():
    assert madin_gold("") is None
    assert madin_gold(None) is None
    assert madin_gold("not-a-madin-category") is None


def test_madin_gold_every_output_is_valid_gold():
    for category, _ in MADIN_RULES:
        g = madin_gold(category)
        assert g is not None and g.startswith(_VALID_PREFIXES), category
        assert nearest(g) == g, category


def test_norm_gold_naming_collapses_mammals_human():
    assert norm_gold_naming(
        "Host-associated:Mammals: Human:Digestive system:Large intestine:Fecal"
    ) == "Host-associated:Human:Digestive system:Large intestine:Fecal"


def test_norm_gold_naming_leaves_valid_paths_unchanged():
    assert norm_gold_naming("Environmental:Aquatic:Marine") == "Environmental:Aquatic:Marine"


def test_norm_gold_naming_collapses_embedded_colon_space_nodes():
    # GOLD's embedded ": " collides with our ':' delimiter and must never survive.
    assert norm_gold_naming("Host-associated:Arthropoda: Crustaceans") == \
        "Host-associated:Arthropoda"
    assert norm_gold_naming("Host-associated:Arthropoda: Chelicerates") == \
        "Host-associated:Arthropoda"
    assert norm_gold_naming("Host-associated:Arthropoda: Insects") == "Host-associated:Insecta"
    deep = norm_gold_naming(
        "Host-associated:Human:Digestive system:Biliary tract:Gallbladder: Bile")
    assert ": " not in deep
    assert deep == "Host-associated:Human:Digestive system:Biliary tract:Gallbladder"


def test_validity_set_never_contains_colon_space():
    assert not any(": " in p for p in _iter_xlsx_paths(GOLD_XLSX_PATH))
    assert not any(": " in p for p in gold_prefixes())
    # the real-DB arthropod truncations must not snap to bare host
    assert nearest("Host-associated:Arthropoda") == "Host-associated:Arthropoda"
    assert nearest("Host-associated:Insecta") == "Host-associated:Insecta"


def test_every_rule_output_validates_against_prefix_set():
    """nearest() never truncates a curated rule/madin output."""
    for _, g in RULES:
        assert nearest(g) == g, g
    for _, g in MADIN_RULES:
        assert nearest(g) == g, g


def test_seeded_beyond_xlsx_is_the_documented_deviation_surface():
    """Pin the small set of leaves seeded beyond the GOLD sheet so rule drift is caught."""
    xlsx = set(_iter_xlsx_paths(GOLD_XLSX_PATH))
    seeded_extra = set()
    for path in _curated_paths():
        segs = path.split(":")
        for i in range(1, len(segs) + 1):
            candidate = ":".join(segs[:i])
            if candidate not in xlsx:
                seeded_extra.add(candidate)
    # MGnify spellings of real GOLD leaves with an intermediate level dropped
    # (GOLD: Human:Integumentary system:Skin; we: Human:Skin).
    assert seeded_extra == {
        "Environmental:Aquatic:Sediment",
        "Environmental:Terrestrial:Soil:Forest soil",
        "Host-associated:Human:Digestive system:Oral",
        "Host-associated:Human:Excretory system",
        "Host-associated:Human:Skin",
        "Host-associated:Mammals:Digestive system:Oral",
        "Host-associated:Mammals:Excretory system",
        "Host-associated:Mammals:Skin",
        "Host-associated:Plants:Rhizosphere",
    }


def test_prefix_set_is_authoritative_gold_dominant():
    xlsx = set(_iter_xlsx_paths(GOLD_XLSX_PATH))
    assert len(xlsx) > 2000
    assert len(gold_prefixes()) - len(xlsx) == 9


def test_own_metadata_prefers_ncbi_isolation_source():
    out = own_metadata_path({"ncbi_isolation_source": "soil",
                             "biosample_isolation_source": "sea water"})
    assert out == ("Environmental:Terrestrial:Soil", "ncbi_isolation_source")


def test_own_metadata_reads_biosample_isolation_source_when_ncbi_absent():
    out = own_metadata_path({"biosample_isolation_source": "sea water"})
    assert out == ("Environmental:Aquatic:Marine", "biosample_isolation_source")


def test_own_metadata_falls_back_to_host_scientific_name():
    out = own_metadata_path({"host_scientific_name": "Homo sapiens"})
    assert out == ("Host-associated:Human", "host_scientific_name")


def test_own_metadata_host_outranks_the_envo_triad():
    # Host outranks the ENVO triad: "bovine milk" alone would go to Fermented beverages.
    out = own_metadata_path({"host_scientific_name": "Homo sapiens",
                             "environment_material": "soil"})
    assert out == ("Host-associated:Human", "host_scientific_name")


def test_own_metadata_envo_triad_runs_material_then_feature_then_biome():
    assert own_metadata_path({"environment_material": "soil",
                              "environment_feature": "sea water",
                              "environment_biome": "sea water"})[1] == "environment_material"
    assert own_metadata_path({"environment_feature": "soil",
                              "environment_biome": "sea water"})[1] == "environment_feature"
    assert own_metadata_path({"environment_biome": "soil"})[1] == "environment_biome"


def test_own_metadata_ignores_an_envo_triad_derived_from_the_current_path():
    # A triad manufactured from the current path would launder the old guess back in.
    derived = gold_to_envo("Host-associated:Plants")
    assert own_metadata_path(dict(derived), current_path="Host-associated:Plants") is None


def test_own_metadata_reads_an_independent_envo_triad():
    # The triad doesn't match gold_to_envo(path), so it is real evidence.
    out = own_metadata_path({"environment_material": "marine sediment",
                             "environment_feature": "seashore",
                             "environment_biome": "East China Sea"},
                            current_path="Host-associated:Plants")
    assert out == ("Environmental:Aquatic:Marine:Sediment", "environment_material")


def test_own_metadata_does_not_treat_the_stored_path_as_a_floor():
    # current_path is only for derivation detection; the stored path is often the guess
    # being deleted, so it must not veto a coarser candidate.
    out = own_metadata_path({"ncbi_isolation_source": "soil"},
                            current_path="Environmental:Terrestrial:Soil:Agricultural land")
    assert out == ("Environmental:Terrestrial:Soil", "ncbi_isolation_source")
    out = own_metadata_path({"ncbi_isolation_source": "soil"},
                            current_path="Environmental:Aquatic:Marine")
    assert out == ("Environmental:Terrestrial:Soil", "ncbi_isolation_source")


def test_own_metadata_with_nothing_resolvable_is_none():
    assert own_metadata_path({}) is None
    assert own_metadata_path({"ncbi_isolation_source": "", "host_scientific_name": None}) is None
    assert own_metadata_path({"ncbi_isolation_source": "not known"}) is None


def test_ecosystem_for_gold_wins_over_own_metadata_and_species():
    # SAMD00000014 is in the committed GOLD map (Fish/Circulatory/Blood).
    out = ecosystem_for("SAMD00000014", {"ncbi_isolation_source": "soil"},
                        "sorangium cellulosum_b")
    assert out == {
        "gold_ecosystem_path": "Host-associated:Fish:Circulatory system:Blood",
        "ecosystem_source": "GOLD",
    }


def test_ecosystem_for_gold_human_form_is_normalized():
    # SAMD00000355 is stored GOLD-form "Mammals: Human".
    out = ecosystem_for("SAMD00000355", {}, None)
    assert out["ecosystem_source"] == "GOLD"
    assert out["gold_ecosystem_path"].startswith("Host-associated:Human")
    assert "Mammals: Human" not in out["gold_ecosystem_path"]


def test_ecosystem_for_own_metadata_wins_over_species():
    out = ecosystem_for("NO_SUCH_BIOSAMPLE", {"ncbi_isolation_source": "soil"},
                        "sorangium cellulosum_b")
    assert out == {
        "gold_ecosystem_path": "Environmental:Terrestrial:Soil",
        "ecosystem_source": "ncbi_isolation_source",
    }


def test_ecosystem_for_reports_the_winning_field_as_the_source():
    out = ecosystem_for(None, {"host_scientific_name": "Homo sapiens"}, None)
    assert out["ecosystem_source"] == "host_scientific_name"
    out = ecosystem_for(None, {"biosample_isolation_source": "sea water"}, None)
    assert out["ecosystem_source"] == "biosample_isolation_source"


def test_ecosystem_for_own_metadata_beats_madin_via_a_late_cascade_field():
    # No isolation_source; evidence only in the ENVO triad.
    out = ecosystem_for("NO_SUCH_BIOSAMPLE",
                        {"environment_material": "marine sediment"},
                        "sorangium cellulosum_b")
    assert out == {
        "gold_ecosystem_path": "Environmental:Aquatic:Marine:Sediment",
        "ecosystem_source": "environment_material",
    }


def test_ecosystem_for_skips_own_metadata_derived_from_the_current_path():
    derived = gold_to_envo("Host-associated:Plants")
    out = ecosystem_for("NO_SUCH_BIOSAMPLE", dict(derived), "arenibacter hampyeongensis",
                        current_path="Host-associated:Plants")
    assert out["ecosystem_source"] == "madin"
    assert out["gold_ecosystem_path"] == "Environmental:Aquatic:Marine:Sediment"


def test_ecosystem_for_species_madin_last_resort():
    # arenibacter is isolation_source=sediment_marine in the committed Madin table.
    out = ecosystem_for(None, {}, "arenibacter hampyeongensis")
    assert out == {
        "gold_ecosystem_path": "Environmental:Aquatic:Marine:Sediment",
        "ecosystem_source": "madin",
        "isolation_category": "sediment_marine",
    }


def test_ecosystem_for_madin_endotherm_is_generic_but_keeps_category():
    # committed species with Madin isolation_source host_animal_endotherm_intestinal
    out = ecosystem_for(None, {}, "f0332 sp000466165")
    assert out == {
        "gold_ecosystem_path": "Host-associated",
        "ecosystem_source": "madin",
        "isolation_category": "host_animal_endotherm_intestinal",
    }
    assert "Mammals" not in out["gold_ecosystem_path"]


def test_ecosystem_for_non_madin_layers_have_no_isolation_category():
    assert "isolation_category" not in ecosystem_for("SAMD00000014", {}, None)
    own = ecosystem_for("NO_SUCH_BIOSAMPLE", {"ncbi_isolation_source": "soil"},
                        "arenibacter hampyeongensis")
    assert own["ecosystem_source"] == "ncbi_isolation_source"
    assert "isolation_category" not in own


def test_ecosystem_for_all_absent_is_none():
    assert ecosystem_for(None, {}, None) is None
    assert ecosystem_for("", {}, "") is None
    assert ecosystem_for("NO_SUCH_BIOSAMPLE", {"ncbi_isolation_source": "not known"},
                         "not-a-species") is None
    # a Madin species with an empty isolation_source yields traits only
    assert ecosystem_for(None, {}, "apibacter adventoris") is None


def test_madin_traits_for_renames_and_filters_empty():
    traits = madin_traits_for("sorangium cellulosum_b")
    assert traits == {
        "optimum_ph": "9.5",
        "optimum_temperature": "28",
        "oxygen_metabolism": "aerobic",
        "gram_stain": "negative",
        "range_salinity": "non-halophilic",
        "cell_shape": "bacillus",
    }


def test_madin_traits_for_only_non_empty_cells():
    # apibacter adventoris has only a metabolism value in the committed table
    assert madin_traits_for("apibacter adventoris") == {"oxygen_metabolism": "microaerophilic"}


def test_madin_traits_for_absent_species_is_empty():
    assert madin_traits_for("not-a-species") == {}
    assert madin_traits_for(None) == {}
    assert madin_traits_for("") == {}


def test_load_gold_duplicate_raises(tmp_path):
    header = "\t".join(GOLD_COLUMNS)
    row = "\t".join(["SAMN1", "Environmental:Terrestrial:Soil"])
    p = _write(tmp_path / "g.tsv", [header, row, row])
    with pytest.raises(ValueError):
        load_gold_biosample_ecosystem(p)


def test_load_gold_header_mismatch_raises(tmp_path):
    p = _write(tmp_path / "g.tsv", ["ncbi_biosample\twrong", "SAMN1\tx"])
    with pytest.raises(ValueError):
        load_gold_biosample_ecosystem(p)


def test_load_madin_ragged_raises(tmp_path):
    header = "\t".join(MADIN_COLUMNS)
    short = "\t".join(["sp1"] * (len(MADIN_COLUMNS) - 1))
    p = _write(tmp_path / "m.tsv", [header, short])
    with pytest.raises(ValueError):
        load_madin_species_traits(p)


def test_load_madin_duplicate_raises(tmp_path):
    header = "\t".join(MADIN_COLUMNS)
    row = "\t".join(["sp1"] + [""] * (len(MADIN_COLUMNS) - 1))
    p = _write(tmp_path / "m.tsv", [header, row, row])
    with pytest.raises(ValueError):
        load_madin_species_traits(p)


def test_integration_row_counts():
    assert len(load_gold_biosample_ecosystem()) == 93977
    assert len(load_madin_species_traits()) == 9087


def test_integration_every_gold_map_path_is_valid_gold():
    """Every committed GOLD-map path is valid GOLD with no embedded ": "."""
    for biosample, raw_path in load_gold_biosample_ecosystem().items():
        collapsed = norm_gold_naming(raw_path)
        assert ": " not in collapsed, (biosample, raw_path, collapsed)
        assert nearest(collapsed) == collapsed, (biosample, collapsed)
        out = ecosystem_for(biosample, None, None)
        assert out is not None and out["ecosystem_source"] == "GOLD", biosample
        path = out["gold_ecosystem_path"]
        assert path.startswith(_VALID_PREFIXES), (biosample, path)
        assert ": " not in path, (biosample, path)


def test_integration_arthropod_l1_rows_recover_taxon():
    """'Arthropoda: <Type>' L1 rows must resolve under the taxon, not bare Host-associated."""
    gold_map = load_gold_biosample_ecosystem()
    insect_rows = [b for b, p in gold_map.items() if p.startswith("Host-associated:Arthropoda: Insects")]
    other_arth = [b for b, p in gold_map.items()
                  if "Arthropoda" in p and not p.startswith("Host-associated:Arthropoda: Insects")]
    assert insect_rows and other_arth
    for b in insect_rows:
        path = ecosystem_for(b, None, None)["gold_ecosystem_path"]
        assert path.startswith("Host-associated:Insecta"), (b, path)
    for b in other_arth:
        path = ecosystem_for(b, None, None)["gold_ecosystem_path"]
        assert path.startswith("Host-associated:Arthropoda"), (b, path)


def test_integration_every_madin_isolation_source_resolves_to_valid_gold():
    """Every Madin isolation_source resolves to a valid GOLD path or None."""
    madin = load_madin_species_traits()
    resolved = 0
    for species, row in madin.items():
        iso = (row.get("isolation_source") or "").strip()
        if not iso:
            continue
        g = madin_gold(iso)
        if g is not None:
            resolved += 1
            assert g.startswith(_VALID_PREFIXES), (species, iso, g)
    assert resolved > 7000


def test_integration_committed_endotherm_species_never_claim_mammals():
    """Committed endotherm species resolve to generic Host-associated, never Mammals/Human."""
    madin = load_madin_species_traits()
    checked = 0
    for species, row in madin.items():
        iso = (row.get("isolation_source") or "").strip()
        if not iso.startswith("host_animal_endotherm"):
            continue
        checked += 1
        out = ecosystem_for(None, None, species)
        assert out is not None and out["ecosystem_source"] == "madin", species
        assert out["gold_ecosystem_path"] == "Host-associated", (species, out)
        assert out["isolation_category"] == iso, species
    assert checked > 1500


def test_caches_are_reused(monkeypatch):
    import scripts.populator.adapters.gtdb_ecosystem as G
    ecosystem_for("SAMD00000014", None, None)
    madin_traits_for("sorangium cellulosum_b")
    gold_prefixes()
    boom = lambda *a, **k: (_ for _ in ()).throw(
        AssertionError("loader re-invoked after cache prime"))
    monkeypatch.setattr(G, "load_gold_biosample_ecosystem", boom)
    monkeypatch.setattr(G, "load_madin_species_traits", boom)
    monkeypatch.setattr(G, "_build_gold_prefixes", boom)
    assert ecosystem_for("SAMD00000014", None, None) is not None
    assert madin_traits_for("sorangium cellulosum_b") != {}
    assert len(gold_prefixes()) > 2000


def _load_iso_cases():
    """Parse fixtures/iso_classify_cases.tsv; a blank expected column means None."""
    path = pathlib.Path(__file__).parent / "fixtures" / "iso_classify_cases.tsv"
    cases = []
    for line in path.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        parts = line.split("\t")
        assert len(parts) == 4, f"malformed fixture row: {line!r}"
        kind, text, expected, why = parts
        cases.append((kind, text, expected or None, why))
    return cases


_ISO_CASES = _load_iso_cases()


def test_iso_cases_fixture_has_both_kinds():
    kinds = {k for k, _, _, _ in _ISO_CASES}
    assert kinds == {"regression", "anchor"}, kinds
    assert sum(1 for k, *_ in _ISO_CASES if k == "regression") >= 30
    assert sum(1 for k, *_ in _ISO_CASES if k == "anchor") >= 15


@pytest.mark.parametrize("kind,text,expected,why", _ISO_CASES,
                         ids=[f"{k}:{t[:45]}" for k, t, _, _ in _ISO_CASES])
def test_iso_classify_corpus_cases(kind, text, expected, why):
    assert iso_classify(text) == expected, why


def test_ecosystem_for_keeps_madin_when_own_metadata_is_strictly_coarser():
    # "Plant roots" resolves only to Host-associated:Plants; Madin knows :Roots
    # (arenibacter hampyeongensis is sediment_marine).
    out = ecosystem_for("NO_SUCH_BIOSAMPLE", {"ncbi_isolation_source": "sea water"},
                        "arenibacter hampyeongensis")
    assert out["gold_ecosystem_path"] == "Environmental:Aquatic:Marine:Sediment"
    assert out["ecosystem_source"] == "madin"


def test_ecosystem_for_own_metadata_still_wins_when_it_is_not_coarser():
    out = ecosystem_for("NO_SUCH_BIOSAMPLE", {"ncbi_isolation_source": "soil"},
                        "arenibacter hampyeongensis")
    assert out["gold_ecosystem_path"] == "Environmental:Terrestrial:Soil"
    assert out["ecosystem_source"] == "ncbi_isolation_source"


def test_own_metadata_skips_only_the_derived_fields_of_a_partial_triad():
    # A partial triad: a real biome beside a manufactured material. Only the derived
    # fields are skipped.
    derived = gold_to_envo("Host-associated:Plants")
    out = own_metadata_path({"environment_material": derived["environment_material"],
                             "environment_feature": derived["environment_feature"],
                             "environment_biome": "sea water"},
                            current_path="Host-associated:Plants")
    assert out == ("Environmental:Aquatic:Marine", "environment_biome")
