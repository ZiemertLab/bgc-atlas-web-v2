import os

import pytest

from scripts.populator.adapters.custom import emit_archive, source_name

ARCH = ("/data/bgc-atlas/data-v2/custom-datasets/"
        "fram_ras/FRAM_RAS_F4_03_1819_1-contigs.tar.gz")
needs_archive = pytest.mark.skipif(not os.path.exists(ARCH), reason="real archive not mounted")

def test_source_name_snake():
    assert source_name("fram_ras") == "custom_fram_ras"
    assert source_name("deep-sea-hydrothermal") == "custom_deep_sea_hydrothermal"

@needs_archive
def test_emit_archive_produces_expected_tables():
    recs = list(emit_archive(ARCH, dataset="fram_ras"))
    tables = {r.table for r in recs}
    assert {"data_sources", "samples", "assemblies", "analyses",
            "antismash_runs", "bgcs", "sample_assemblies",
            "sample_analyses", "assembly_analyses"} <= tables
    bgc = next(r for r in recs if r.table == "bgcs")
    assert bgc.fields["filename"].startswith("FRAM_RAS_F4_03_1819_1_")
    assert bgc.refs["assembly"][0] == "assemblies"
    ds = next(r for r in recs if r.table == "data_sources")
    assert ds.fields["name"] == "custom_fram_ras" and ds.fields["source_type"] == "custom"

@needs_archive
def test_emitted_records_finalize_without_errors():
    from scripts.populator.core.registry import Registry
    reg = Registry()
    for r in emit_archive(ARCH, dataset="fram_ras"):
        reg.add(r)
    tables = reg.finalize()
    assert tables["bgcs"] and tables["antismash_runs"]
    assert tables["bgcs"][0]["assembly"] and tables["bgcs"][0]["antismash_run_id"]


def test_emit_archive_multi_region_distinct_filenames(monkeypatch):
    import json, pathlib
    from scripts.populator.adapters import custom
    fix = json.loads(
        (pathlib.Path(__file__).parent / "fixtures" / "as_two_region.json").read_text()
    )
    monkeypatch.setattr(custom, "load_json", lambda p: fix)
    recs = list(custom.emit_archive("/x/MULTI-contigs.tar.gz", dataset="fram_ras"))
    bgcs = [r for r in recs if r.table == "bgcs"]
    fnames = [b.fields["filename"] for b in bgcs]
    assert len(bgcs) == 3
    assert len(set(fnames)) == 3
    assert "MULTI_contigA.region001" in fnames
    assert "MULTI_contigA.region002" in fnames        # 2nd region on same contig, zero-padded
    assert "MULTI_contigB.region001" in fnames


def test_antismash_run_name_has_no_tar_suffix(monkeypatch):
    import json, pathlib
    from scripts.populator.adapters import custom
    fix = json.loads(
        (pathlib.Path(__file__).parent / "fixtures" / "as_one_region.json").read_text()
    )
    monkeypatch.setattr(custom, "load_json", lambda p: fix)
    recs = list(custom.emit_archive("/x/SAMPLE-contigs.tar.gz", dataset="fram_ras"))
    run = next(r for r in recs if r.table == "antismash_runs")
    assert run.fields["name"] == "SAMPLE-contigs"


def _fixture(monkeypatch):
    import json, pathlib
    from scripts.populator.adapters import custom
    fix = json.loads(
        (pathlib.Path(__file__).parent / "fixtures" / "as_one_region.json").read_text()
    )
    monkeypatch.setattr(custom, "load_json", lambda p: fix)
    return custom


def test_emit_archive_mfd_attaches_env_fields(monkeypatch):
    # stem 'MFD00008-contigs' -> alias 'MFD00008', a real MFD barcode
    custom = _fixture(monkeypatch)
    recs = list(custom.emit_archive("/x/MFD00008-contigs.tar.gz",
                                    dataset="microflora_danica"))
    src = next(r for r in recs if r.table == "data_sources")
    assert src.fields["name"] == "custom_microflora_danica"
    samp = next(r for r in recs if r.table == "samples")
    assert samp.fields["latitude"] == pytest.approx(55.60587)
    assert samp.fields["gold_ecosystem_path"] == "Environmental:Terrestrial:Soil:Forest soil"
    assert samp.fields["geographic_location"] == "Denmark"
    assert samp.fields["accession"] == "MFD00008"


def test_emit_archive_mfd_env_reaches_written_tsv(monkeypatch, tmp_path):
    from scripts.populator.core.registry import Registry
    from scripts.populator.core.writer import write_tables
    from scripts.populator.schema import TABLES

    custom = _fixture(monkeypatch)
    reg = Registry()
    for r in custom.emit_archive("/x/MFD00008-contigs.tar.gz",
                                 dataset="microflora_danica"):
        reg.add(r)
    write_tables(reg.finalize(), tmp_path, emit_tsv=True)

    cols = list(TABLES["samples"].columns)
    line = (tmp_path / "samples.tsv").read_text().splitlines()[0].split("\t")
    row = dict(zip(cols, line))
    assert "gold_ecosystem_path" in cols and "geolocation_name" in cols
    assert row["gold_ecosystem_path"] == "Environmental:Terrestrial:Soil:Forest soil"
    assert row["geolocation_name"] == "20, Hjelmdrup By, Egtved"
    assert row["geographic_location"] == "Denmark"
    assert row["latitude"] == "55.60587"


def test_emit_archive_non_mfd_dataset_no_env_and_no_mfd_load(monkeypatch):
    custom = _fixture(monkeypatch)

    def boom(*a, **k):
        raise AssertionError("enrichment_for must not be called for non-MFD datasets")

    monkeypatch.setattr(custom.mfd_metadata, "enrichment_for", boom)
    recs = list(custom.emit_archive("/x/SAMPLE-contigs.tar.gz", dataset="fram_ras"))
    samp = next(r for r in recs if r.table == "samples")
    assert "latitude" not in samp.fields
    assert "gold_ecosystem_path" not in samp.fields


def test_emit_archive_mfd_emits_prjeb_study_and_source_url(monkeypatch):
    # same nk as the long-read MAGs' PRJEB58634 study
    from scripts.populator.ids import entity_id, scoped
    from scripts.populator.adapters import custom as custom_mod
    custom = _fixture(monkeypatch)
    recs = list(custom.emit_archive("/x/MFD00008-contigs.tar.gz",
                                    dataset="microflora_danica"))
    ds = next(r for r in recs if r.table == "data_sources")
    assert ds.fields["source_url"] == custom_mod.mfd_metadata.MFD_SOURCE_URL
    study = next(r for r in recs if r.table == "studies")
    assert study.natural_key == "PRJEB58634"
    assert study.fields["accession"] == "PRJEB58634"
    assert study.fields["study_name"] == "Microflora Danica (long-read)"
    assert study.fields["data_source_ids"] == [
        str(entity_id("data_sources", "custom_microflora_danica")),
        str(entity_id("data_sources", "Microflora Danica (long-read)"))]
    link = next(r for r in recs if r.table == "study_samples")
    assert link.refs["study_id"] == ("studies", "PRJEB58634")
    assert link.refs["sample_id"] == (
        "samples", scoped("custom_microflora_danica", "MFD00008"))


def test_emit_archive_non_mfd_dataset_no_study_no_source_url(monkeypatch):
    custom = _fixture(monkeypatch)
    recs = list(custom.emit_archive("/x/SAMPLE-contigs.tar.gz", dataset="fram_ras"))
    assert not any(r.table == "studies" for r in recs)
    assert not any(r.table == "study_samples" for r in recs)
    ds = next(r for r in recs if r.table == "data_sources")
    assert "source_url" not in ds.fields


def test_emit_archive_emit_source_carries_biosample_metadata(monkeypatch):
    # datasets in customs_metadata.EMIT_SOURCES load with their BioSample metadata and paper url
    custom = _fixture(monkeypatch)
    recs = list(custom.emit_archive("/x/ERZ10645735.tar.gz", dataset="helgoland-2020"))
    samp = next(r for r in recs if r.table == "samples")
    assert samp.fields["accession"] == "SAMEA14431080"
    assert samp.fields["gold_ecosystem_path"] == "Environmental:Aquatic:Marine:Coastal"
    assert samp.fields["latitude"] == 54.19
    ds = next(r for r in recs if r.table == "data_sources")
    assert ds.fields["source_url"] == "https://doi.org/10.1186/s40168-023-01557-3"
    assert not any(r.table == "studies" for r in recs)   # the study comes from backfill_custom_studies


def test_emit_archive_emit_source_without_metadata_row_fails(monkeypatch):
    import pytest
    custom = _fixture(monkeypatch)
    with pytest.raises(KeyError):
        list(custom.emit_archive("/x/ERZ0000.tar.gz", dataset="great-barrier-reef"))
