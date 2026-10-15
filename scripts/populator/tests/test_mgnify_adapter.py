import io
import json
import tarfile
from pathlib import Path
import pytest
from scripts.populator.adapters import mgnify

FIXTURE_META = Path(__file__).parent / "fixtures" / "mgnify_meta"

_DEFAULT_REGIONS = {"taxon": "bacteria", "records": [{"id": "ctg1",
    "areas": [{"start": 0, "end": 100, "products": ["terpene"],
               "protoclusters": {"0": {"category": "terpene", "core_start": 10,
                                       "core_end": 90, "product": "terpene"}}}],
    "features": [{"type": "region", "location": "[0:100](+)",
                  "qualifiers": {"region_number": ["1"], "contig_edge": ["False"]}}]}]}


def _add_bytes(tar, name, data: bytes):
    info = tarfile.TarInfo(name)
    info.size = len(data)
    tar.addfile(info, io.BytesIO(data))


def _make_run_tar(tmp_path, run_key, regions=None):
    """A run tarball with regions.json nested as <run_key>/<run_key>/<run_key>_regions.json,
    like the real mgnify_runs_tar layout."""
    if regions is None:
        regions = _DEFAULT_REGIONS
    tarpath = tmp_path / f"{run_key}.tar.gz"
    payload = json.dumps(regions).encode("utf-8")
    with tarfile.open(tarpath, "w:gz") as tar:
        _add_bytes(tar, f"{run_key}/{run_key}/{run_key}_regions.json", payload)
    return str(tarpath)


def _make_tar_without_regions(tmp_path, run_key):
    tarpath = tmp_path / f"{run_key}.tar.gz"
    with tarfile.open(tarpath, "w:gz") as tar:
        _add_bytes(tar, f"{run_key}/note.txt", b"no regions here")
    return str(tarpath)


def test_run_key_splits_analysis_assembly(tmp_path):
    rk = "MGYA00069120_ERZ312747"
    tar = _make_run_tar(tmp_path, rk)
    recs = list(mgnify.emit_run_archive(tar))
    asm = next(r for r in recs if r.table == "assemblies")
    ana = next(r for r in recs if r.table == "analyses")
    assert asm.fields["accession"] == "ERZ312747"
    assert ana.fields["accession"] == "MGYA00069120"
    bgc = next(r for r in recs if r.table == "bgcs")
    assert bgc.fields["filename"] == "MGYA00069120_ERZ312747_ctg1.region001"  # base=run_key
    assert bgc.refs["assembly"][0] == "assemblies"
    assert not any(r.table == "samples" for r in recs)


def test_emitted_records_finalize_without_errors(tmp_path):
    from scripts.populator.core.registry import Registry
    tar = _make_run_tar(tmp_path, "MGYA1_ERZ1")
    reg = Registry()
    for r in mgnify.emit_run_archive(tar):
        reg.add(r)
    tables = reg.finalize()
    assert tables["bgcs"] and tables["assemblies"] and tables["analyses"]
    assert "samples" not in tables


def test_no_underscore_run_key_raises(tmp_path):
    # a tar stem with no "_" gives an empty assembly part
    tar = _make_run_tar(tmp_path, "NOUNDERSCORE")
    with pytest.raises(ValueError):
        list(mgnify.emit_run_archive(tar))


def test_missing_regions_json_raises(tmp_path):
    tar = _make_tar_without_regions(tmp_path, "MGYA1_ERZ1")  # valid run_key, no regions member
    with pytest.raises(FileNotFoundError):
        list(mgnify.emit_run_archive(tar))


def test_corrupt_tarball_raises_readerror(tmp_path):
    """A corrupt tarball raises ReadError, which the orchestrator catches per archive."""
    bad = tmp_path / "MGYA1_ERZ1.tar.gz"
    bad.write_bytes(b"this is not a gzip stream")
    with pytest.raises(tarfile.ReadError):
        list(mgnify.emit_run_archive(str(bad)))


def test_malformed_regions_json_raises(tmp_path):
    """Invalid regions JSON raises JSONDecodeError, also caught per archive."""
    rk = "MGYA1_ERZ1"
    tarpath = tmp_path / f"{rk}.tar.gz"
    with tarfile.open(tarpath, "w:gz") as tar:
        _add_bytes(tar, f"{rk}/{rk}/{rk}_regions.json", b"{not valid json")
    with pytest.raises(json.JSONDecodeError):
        list(mgnify.emit_run_archive(str(tarpath)))


def test_multi_assembly_accession_keeps_hyphen(tmp_path):
    rk = "MGYA00012323_FAUS01000001-FAUS01000008"
    tar = _make_run_tar(tmp_path, rk)
    recs = list(mgnify.emit_run_archive(tar))
    asm = next(r for r in recs if r.table == "assemblies")
    assert asm.fields["accession"] == "FAUS01000001-FAUS01000008"   # only first "_" splits
    bgc = next(r for r in recs if r.table == "bgcs")
    assert bgc.fields["filename"].startswith(rk + "_ctg")           # base = full run_key


def test_archive_file_path_is_the_tarball(tmp_path):
    """file_path is the .tar.gz, matching mgnify_bgcs.tsv's antismash_run_file_path."""
    tar = _make_run_tar(tmp_path, "MGYA9_ERZ1")
    recs = list(mgnify.emit_run_archive(tar))
    run = next(r for r in recs if r.table == "antismash_runs")
    assert run.fields["file_path"] == str(Path(tar).resolve())
    assert run.fields["file_path"].endswith(".tar.gz")


def test_bgc_path_emits_only_bgc_side_records(tmp_path):
    """Entity metadata comes from the dump post-pass (test_mgnify_dump_emit.py), not here."""
    tar = _make_run_tar(tmp_path, "MGYA9_ERZ1")
    recs = list(mgnify.emit_run_archive(tar))
    tables = {r.table for r in recs}
    assert tables == {"data_sources", "assemblies", "analyses",
                      "antismash_runs", "assembly_analyses", "bgcs"}
    # fallback rows carry name=accession; a dump row later overwrites it with NULL
    asm = next(r for r in recs if r.table == "assemblies")
    assert asm.fields["name"] == "ERZ1" and asm.fields["source_type"] == "metagenome"
    ana = next(r for r in recs if r.table == "analyses")
    assert ana.fields["name"] == "MGYA9" and ana.fields["tool_name"] == "antiSMASH"


def test_metadata_dir_arg_is_ignored_for_emission(tmp_path):
    """metadata_dir is vestigial: passing it changes nothing."""
    tar = _make_run_tar(tmp_path, "MGYA9_ERZ1")
    with_dir = {r.table for r in mgnify.emit_run_archive(tar, metadata_dir=str(FIXTURE_META))}
    without = {r.table for r in mgnify.emit_run_archive(tar)}
    assert with_dir == without
    for t in ("samples", "studies", "biomes", "sample_assemblies",
              "sample_analyses", "study_samples", "sample_biomes"):
        assert t not in with_dir


def test_without_metadata_dir_stays_bgc_only(tmp_path):
    tar = _make_run_tar(tmp_path, "MGYA9_ERZ1")
    recs = list(mgnify.emit_run_archive(tar))
    tables = {r.table for r in recs}
    for t in ("samples", "studies", "biomes", "sample_assemblies",
              "sample_analyses", "study_samples", "sample_biomes"):
        assert t not in tables
