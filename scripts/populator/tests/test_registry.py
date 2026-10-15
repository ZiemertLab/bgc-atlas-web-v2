import pytest

from scripts.populator.core.record import Record
from scripts.populator.core.registry import Registry
from scripts.populator import ids


def test_registry_assigns_deterministic_id_and_resolves_fk():
    reg = Registry()
    reg.add(Record("assemblies", "metalog|asmA",
                   {"accession": "asmA", "source_type": "metagenome"}, {}))
    reg.add(Record("bgcs", "asmA_k1.region001",
                   {"filename": "asmA_k1.region001", "contig": "k1",
                    "start_pos": 0, "end_pos": 100},
                   refs={"assembly": ("assemblies", "metalog|asmA")}))
    tables = reg.finalize()
    bgc = tables["bgcs"][0]
    assert bgc["id"] == str(ids.entity_id("bgcs", "asmA_k1.region001"))
    assert bgc["assembly"] == str(ids.entity_id("assemblies", "metalog|asmA"))


def test_registry_dedups_by_natural_key():
    reg = Registry()
    reg.add(Record("data_sources", "metalog", {"name": "metalog"}, {}))
    reg.add(Record("data_sources", "metalog", {"name": "metalog"}, {}))
    assert len(reg.finalize()["data_sources"]) == 1


def test_finalize_raises_on_undeclared_ref_column():
    reg = Registry()
    reg.add(Record("gcfs", "GCF_x", {"name": "GCF_x"},
                   refs={"bogus": ("gcfs", "GCF_y")}))
    with pytest.raises(KeyError):
        reg.finalize()


def test_finalize_raises_on_unknown_table():
    reg = Registry()
    reg.add(Record("not_a_table", "x", {"a": 1}, {}))
    with pytest.raises(KeyError):
        reg.finalize()


def test_finalize_raises_on_unknown_entity_ref():
    reg = Registry()
    reg.add(Record("bgcs", "f1", {"filename": "f1"},
                   refs={"assembly": ("not_an_entity", "x")}))
    with pytest.raises(KeyError):
        reg.finalize()


def test_data_source_ids_populated_from_provenance():
    from scripts.populator.core.record import Record
    from scripts.populator.core.registry import Registry
    from scripts.populator import ids
    reg = Registry()
    reg.add(Record("data_sources", "custom_x", {"name": "custom_x"}, {}))
    reg.add(Record("samples", "custom_x|s1", {"external_id": "custom_x|s1"}, {}))
    reg.set_provenance("samples", "custom_x|s1", "custom_x")
    row = reg.finalize()["samples"][0]
    assert row["data_source_ids"] == [str(ids.entity_id("data_sources", "custom_x"))]

def test_data_source_ids_supports_multiple_sources():
    reg = Registry()
    reg.add(Record("samples", "metalog|s1", {"external_id": "metalog|s1"}, {}))
    reg.set_provenance("samples", "metalog|s1", ["metalog", "SPIRE"])
    row = reg.finalize()["samples"][0]
    assert row["data_source_ids"] == [
        str(ids.entity_id("data_sources", "metalog")),
        str(ids.entity_id("data_sources", "SPIRE")),
    ]


def test_set_provenance_accumulates_deduped():
    reg = Registry()
    reg.add(Record("samples", "metalog|s2", {"external_id": "metalog|s2"}, {}))
    reg.set_provenance("samples", "metalog|s2", "metalog")
    reg.set_provenance("samples", "metalog|s2", ["SPIRE", "metalog"])
    row = reg.finalize()["samples"][0]
    assert row["data_source_ids"] == [
        str(ids.entity_id("data_sources", "metalog")),
        str(ids.entity_id("data_sources", "SPIRE")),
    ]


def test_no_provenance_leaves_data_source_ids_unset():
    from scripts.populator.core.record import Record
    from scripts.populator.core.registry import Registry
    reg = Registry()
    reg.add(Record("samples", "custom_x|s2", {"external_id": "custom_x|s2"}, {}))
    row = reg.finalize()["samples"][0]
    assert "data_source_ids" not in row or row.get("data_source_ids") is None


def test_drop_dangling_junctions_drops_only_orphan_junction_rows():
    """Orphan junction rows are dropped; valid ones and entity tables are kept."""
    reg = Registry()
    reg.add(Record("runs", "mgnify|RUN1", {"accession": "RUN1"}, {}))
    reg.add(Record("studies", "mgnify|MGYS1", {"accession": "MGYS1"}, {}))
    reg.add(Record("run_studies", "mgnify|RUN1|mgnify|MGYS1", {},
                   refs={"run_id": ("runs", "mgnify|RUN1"),
                         "study_id": ("studies", "mgnify|MGYS1")}))
    reg.add(Record("run_studies", "mgnify|RUN1|mgnify|MGYS_GONE", {},
                   refs={"run_id": ("runs", "mgnify|RUN1"),
                         "study_id": ("studies", "mgnify|MGYS_GONE")}))

    dropped = reg.drop_dangling_junctions()
    assert dropped == {"run_studies": 1}

    tables = reg.finalize()
    assert len(tables["run_studies"]) == 1
    surviving = tables["run_studies"][0]
    assert surviving["study_id"] == str(ids.entity_id("studies", "mgnify|MGYS1"))
    assert len(tables["runs"]) == 1
    assert len(tables["studies"]) == 1


def test_drop_dangling_junctions_never_filters_entity_tables():
    reg = Registry()
    # antismash_runs is an entity with FK refs whose targets are absent here
    reg.add(Record("antismash_runs", "/x/run.tar.gz",
                   {"file_path": "/x/run.tar.gz", "name": "run"},
                   refs={"analysis_id": ("analyses", "mgnify|GONE_A"),
                         "assembly_id": ("assemblies", "mgnify|GONE_ASM")}))
    dropped = reg.drop_dangling_junctions()
    assert "antismash_runs" not in dropped
    assert len(reg._rows["antismash_runs"]) == 1
