"""Tests for phase A: assemblies anchor and linkage extraction."""

from scripts.mgnify_v2_crawl import phase_assemblies
from scripts.mgnify_v2_crawl.state import ResumeLog
from scripts.mgnify_v2_crawl.writer import read_keys


def make_get(list_pages, details):
    """`list_pages` are flattened and re-paged by the requested page_size; `details` maps accession -> dict or None (404)."""
    flat = [item for page in sorted(list_pages) for item in list_pages[page]]
    count = len(flat)

    def fake_get(path, params=None, **kwargs):
        if path == "assemblies/":
            params = params or {}
            page = params.get("page", 1)
            size = params.get("page_size", count or 1)
            start = (page - 1) * size
            return {"count": count, "items": flat[start:start + size]}
        acc = path.split("/", 1)[1]
        return details.get(acc, None)

    return fake_get


def test_lists_and_detail_fetches_all_assemblies(tmp_path):
    list_pages = {
        1: [{"accession": "ERZ1", "updated_at": "x"}, {"accession": "ERZ2", "updated_at": "x"}],
        2: [{"accession": "ERZ3", "updated_at": "x"}],
    }
    details = {
        "ERZ1": {
            "accession": "ERZ1",
            "run_accession": "ERR1",
            "sample_accession": "SAMEA1",
            "assembly_study_accession": "MGYS1",
            "reads_study_accession": "MGYS2",
        },
        "ERZ2": {
            "accession": "ERZ2",
            "run_accession": "ERR2",
            "sample_accession": "SAMEA2",
            "assembly_study_accession": "MGYS1",
            "reads_study_accession": None,
        },
        "ERZ3": {
            "accession": "ERZ3",
            "run_accession": None,
            "sample_accession": None,
            "assembly_study_accession": None,
            "reads_study_accession": None,
        },
    }
    get = make_get(list_pages, details)
    log = ResumeLog(str(tmp_path / "crawl.sqlite"))
    stats = phase_assemblies.run(tmp_path, log, get=get)

    assert stats["requested"] == 3
    assert stats["written"] == 3
    assert read_keys(tmp_path / "assemblies.jsonl.gz") == {"ERZ1", "ERZ2", "ERZ3"}


def test_linkage_extraction_drops_nulls_and_unions_studies(tmp_path):
    list_pages = {
        1: [{"accession": "ERZ1"}, {"accession": "ERZ2"}, {"accession": "ERZ3"}],
    }
    details = {
        "ERZ1": {
            "run_accession": "ERR1",
            "sample_accession": "SAMEA1",
            "assembly_study_accession": "MGYS1",
            "reads_study_accession": "MGYS2",
        },
        "ERZ2": {
            "run_accession": "ERR2",
            "sample_accession": "SAMEA2",
            "assembly_study_accession": "MGYS1",  # dup study
            "reads_study_accession": None,  # null dropped
        },
        "ERZ3": {
            "run_accession": None,  # all null
            "sample_accession": None,
            "assembly_study_accession": None,
            "reads_study_accession": None,
        },
    }
    get = make_get(list_pages, details)
    log = ResumeLog(str(tmp_path / "crawl.sqlite"))
    phase_assemblies.run(tmp_path, log, get=get)

    linkage = phase_assemblies.linkage_from_assemblies(tmp_path)
    assert linkage["samples"] == {"SAMEA1", "SAMEA2"}
    assert linkage["runs"] == {"ERR1", "ERR2"}
    assert linkage["studies"] == {"MGYS1", "MGYS2"}


def test_linkage_from_missing_bundle_is_empty(tmp_path):
    linkage = phase_assemblies.linkage_from_assemblies(tmp_path)
    assert linkage == {"samples": set(), "runs": set(), "studies": set()}


def test_404_detail_marked_removed_not_in_bundle(tmp_path):
    list_pages = {1: [{"accession": "ERZ1"}, {"accession": "ERZGONE"}]}
    details = {
        "ERZ1": {"run_accession": "ERR1", "sample_accession": "SAMEA1"},
        "ERZGONE": None,  # 404
    }
    get = make_get(list_pages, details)
    log = ResumeLog(str(tmp_path / "crawl.sqlite"))
    stats = phase_assemblies.run(tmp_path, log, get=get)
    assert stats["removed"] == 1
    assert read_keys(tmp_path / "assemblies.jsonl.gz") == {"ERZ1"}


def test_rerun_is_no_op(tmp_path):
    list_pages = {1: [{"accession": "ERZ1"}, {"accession": "ERZ2"}]}
    details = {
        "ERZ1": {"run_accession": "ERR1", "sample_accession": "SAMEA1"},
        "ERZ2": {"run_accession": "ERR2", "sample_accession": "SAMEA2"},
    }
    get = make_get(list_pages, details)
    log = ResumeLog(str(tmp_path / "crawl.sqlite"))
    phase_assemblies.run(tmp_path, log, get=get)
    stats2 = phase_assemblies.run(tmp_path, log, get=get)
    assert stats2["written"] == 0
    assert stats2["skipped"] == 2
    assert read_keys(tmp_path / "assemblies.jsonl.gz") == {"ERZ1", "ERZ2"}
