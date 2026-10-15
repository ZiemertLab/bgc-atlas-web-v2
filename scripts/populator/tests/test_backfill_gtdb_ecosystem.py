"""Tests for the GTDB ecosystem backfill's pure per-genome decision (no DB)."""
from scripts.populator.adapters.envo_from_gold import gold_to_envo
from scripts.populator.tools.backfill_gtdb_ecosystem import decide, SCOPE_SOURCES


def _row(**kw):
    row = {
        "source": None,
        "envo_source": None,
        "gold_ecosystem_path": None,
        "ncbi_biosample": None,
        "ncbi_isolation_source": None,
        "biosample_isolation_source": None,
        "host_scientific_name": None,
        "environment_biome": None,
        "environment_feature": None,
        "environment_material": None,
        "species": None,
    }
    row.update(kw)
    return row


def test_scope_is_the_three_non_authoritative_cohorts():
    assert set(SCOPE_SOURCES) == {None, "", "madin", "bacdive"}


def test_gold_cohort_is_never_touched():
    d = decide(_row(source="GOLD", gold_ecosystem_path="Host-associated:Fish",
                    ncbi_isolation_source="soil"))
    assert d.write is False


def test_isolation_source_cohort_is_retagged_only():
    d = decide(_row(source="isolation_source", gold_ecosystem_path="Environmental:Terrestrial:Soil",
                    ncbi_isolation_source="soil"))
    assert d.write is True
    assert d.outcome == "retagged"
    assert d.meta_set == {"gtdb_ecosystem_source": "ncbi_isolation_source"}
    assert d.path_changed is False
    assert d.triad is None


def test_bacdive_row_with_no_own_signal_is_dropped_to_null():
    d = decide(_row(source="bacdive", gold_ecosystem_path="Host-associated:Plants"))
    assert d.path is None
    assert d.outcome == "dropped"
    assert d.path_changed is True
    assert "gtdb_ecosystem_source" in d.meta_drop


def test_bacdive_row_with_own_signal_is_corrected():
    # RS_GCF_002895405.1: BacDive said Plants; the BioSample says marine sediment.
    d = decide(_row(source="bacdive", gold_ecosystem_path="Host-associated:Plants",
                    environment_material="marine sediment",
                    environment_feature="seashore",
                    environment_biome="East China Sea"))
    assert d.path == "Environmental:Aquatic:Marine:Sediment"
    assert d.meta_set["gtdb_ecosystem_source"] == "environment_material"
    assert d.outcome == "corrected"


def test_madin_row_yields_to_the_genomes_own_metadata():
    # arenibacter's Madin habitat is Marine:Sediment; soil is a sibling, so the
    # no-coarsening guard doesn't fire.
    d = decide(_row(source="madin", gold_ecosystem_path="Environmental:Aquatic:Marine:Sediment",
                    biosample_isolation_source="soil",
                    species="arenibacter hampyeongensis"))
    assert d.path == "Environmental:Terrestrial:Soil"
    assert d.meta_set["gtdb_ecosystem_source"] == "biosample_isolation_source"
    assert d.outcome == "refined"


def test_madin_row_without_own_signal_keeps_its_path():
    d = decide(_row(source="madin", gold_ecosystem_path="Environmental:Aquatic:Marine:Sediment",
                    species="arenibacter hampyeongensis"))
    assert d.path == "Environmental:Aquatic:Marine:Sediment"
    assert d.path_changed is False
    assert d.outcome == "unchanged"


def test_null_row_with_own_signal_gains_a_path():
    d = decide(_row(source=None, host_scientific_name="Homo sapiens"))
    assert d.path == "Host-associated:Human"
    assert d.meta_set["gtdb_ecosystem_source"] == "host_scientific_name"
    assert d.outcome == "filled"


def test_null_row_without_own_signal_writes_nothing():
    d = decide(_row(source=None))
    assert d.write is False


def test_derived_triad_is_rederived_when_the_path_changes():
    derived = gold_to_envo("Host-associated:Plants")
    d = decide(_row(source="bacdive", gold_ecosystem_path="Host-associated:Plants",
                    biosample_isolation_source="soil", **derived))
    assert d.path == "Environmental:Terrestrial:Soil"
    assert d.triad == gold_to_envo("Environmental:Terrestrial:Soil")
    assert d.meta_set["envo_source"] == "gold_derived"


def test_derived_triad_is_cleared_when_the_path_is_dropped():
    # an orphaned "plant material" would read as real evidence
    derived = gold_to_envo("Host-associated:Plants")
    d = decide(_row(source="bacdive", envo_source="gold_derived",
                    gold_ecosystem_path="Host-associated:Plants", **derived))
    assert d.path is None
    assert d.triad == {"environment_biome": None, "environment_feature": None,
                       "environment_material": None}
    assert "envo_source" in d.meta_drop


def test_no_key_is_dropped_when_it_was_never_stored():
    derived = gold_to_envo("Host-associated:Plants")
    d = decide(_row(source="bacdive", gold_ecosystem_path="Host-associated:Plants", **derived))
    assert d.meta_drop == ("gtdb_ecosystem_source",)


def test_independent_triad_is_never_overwritten():
    d = decide(_row(source="bacdive", gold_ecosystem_path="Host-associated:Plants",
                    environment_material="marine sediment",
                    environment_feature="seashore",
                    environment_biome="East China Sea"))
    assert d.triad is None
    assert "envo_source" not in d.meta_set


def test_derived_triad_is_left_alone_when_the_path_does_not_change():
    derived = gold_to_envo("Environmental:Aquatic:Marine:Sediment")
    d = decide(_row(source="madin", gold_ecosystem_path="Environmental:Aquatic:Marine:Sediment",
                    species="arenibacter hampyeongensis", **derived))
    assert d.path_changed is False
    assert d.triad is None
    assert d.meta_set["envo_source"] == "gold_derived"


def test_bacdive_row_takes_a_coarser_but_evidence_backed_path():
    # The stored path is the guess being deleted; measuring against it would turn
    # evidence-backed Soil into NULL.
    d = decide(_row(source="bacdive",
                    gold_ecosystem_path="Environmental:Terrestrial:Soil:Contaminated",
                    environment_material="soil"))
    assert d.path == "Environmental:Terrestrial:Soil"
    assert d.meta_set["gtdb_ecosystem_source"] == "environment_material"


def test_madin_row_keeps_its_finer_path_when_own_metadata_is_coarser():
    # flavobacterium sp000426145 is soil_forest -> Environmental:Terrestrial:Soil:Forest soil.
    d = decide(_row(source="madin",
                    gold_ecosystem_path="Environmental:Terrestrial:Soil:Forest soil",
                    environment_material="soil",
                    species="flavobacterium sp000426145"))
    assert d.path == "Environmental:Terrestrial:Soil:Forest soil"
    assert d.meta_set["gtdb_ecosystem_source"] == "madin"
    assert d.outcome == "unchanged"


def test_a_row_already_in_its_final_state_is_not_rewritten():
    derived = gold_to_envo("Environmental:Aquatic:Marine:Sediment")
    d = decide(_row(source="madin", envo_source="gold_derived",
                    gold_ecosystem_path="Environmental:Aquatic:Marine:Sediment",
                    species="arenibacter hampyeongensis", **derived))
    assert d.write is False


def test_unchanged_row_with_matching_provenance_is_not_rewritten():
    d = decide(_row(source="madin", gold_ecosystem_path="Environmental:Aquatic:Marine:Sediment",
                    species="arenibacter hampyeongensis"))
    assert d.outcome == "unchanged"
    assert d.write is False


def test_partially_derived_triad_rewrites_only_the_manufactured_fields():
    derived = gold_to_envo("Host-associated:Plants")
    d = decide(_row(source="bacdive", gold_ecosystem_path="Host-associated:Plants",
                    environment_material=derived["environment_material"],
                    environment_feature=derived["environment_feature"],
                    environment_biome="sea water"))
    assert d.path == "Environmental:Aquatic:Marine"
    new = gold_to_envo("Environmental:Aquatic:Marine")
    assert d.triad == {"environment_biome": "sea water",
                       "environment_feature": new["environment_feature"],
                       "environment_material": new["environment_material"]}
