"""``max_pages`` caps each paginating phase to that many list items; None is unlimited."""

from scripts.mgnify_v2_crawl import phase_analyses, phase_assemblies, phase_extras
from scripts.mgnify_v2_crawl.state import ResumeLog
from scripts.mgnify_v2_crawl.writer import read_keys

from scripts.mgnify_v2_crawl.tests.test_phase_assemblies import (
    make_get as assemblies_get,
)
from scripts.mgnify_v2_crawl.tests.test_phase_extras import (
    make_get as extras_get,
    _full_collections,
    _full_details,
)


def test_assemblies_max_pages_caps_accessions(tmp_path):
    list_pages = {
        1: [{"accession": "ERZ1"}, {"accession": "ERZ2"}, {"accession": "ERZ3"}],
    }
    details = {
        "ERZ1": {"sample_accession": "SAMEA1"},
        "ERZ2": {"sample_accession": "SAMEA2"},
        "ERZ3": {"sample_accession": "SAMEA3"},
    }
    get = assemblies_get(list_pages, details)
    log = ResumeLog(str(tmp_path / "crawl.sqlite"))
    stats = phase_assemblies.run(tmp_path, log, get=get, max_pages=2)
    assert stats["requested"] == 2
    assert read_keys(tmp_path / "assemblies.jsonl.gz") == {"ERZ1", "ERZ2"}


def test_assemblies_max_pages_none_is_unlimited(tmp_path):
    list_pages = {1: [{"accession": "ERZ1"}, {"accession": "ERZ2"}]}
    details = {"ERZ1": {"sample_accession": "S1"}, "ERZ2": {"sample_accession": "S2"}}
    get = assemblies_get(list_pages, details)
    log = ResumeLog(str(tmp_path / "crawl.sqlite"))
    stats = phase_assemblies.run(tmp_path, log, get=get, max_pages=None)
    assert stats["requested"] == 2
    assert read_keys(tmp_path / "assemblies.jsonl.gz") == {"ERZ1", "ERZ2"}


def test_analyses_max_pages_caps_list_scan(tmp_path):
    items = [
        {"accession": "MGYA1", "sample": {"accession": "SAMEA1"}},
        {"accession": "MGYA2", "sample": {"accession": "SAMEA1"}},
        {"accession": "MGYA3", "sample": {"accession": "SAMEA1"}},
    ]
    details = {
        "analyses/MGYA1": {"accession": "MGYA1"},
        "analyses/MGYA2": {"accession": "MGYA2"},
        "analyses/MGYA3": {"accession": "MGYA3"},
    }

    def get(path, params=None, **kwargs):
        if path == "analyses/":
            params = params or {}
            page = params.get("page", 1)
            size = params.get("page_size", len(items) or 1)
            start = (page - 1) * size
            return {"count": len(items), "items": items[start:start + size]}
        return details.get(path)

    log = ResumeLog(str(tmp_path / "crawl.sqlite"))
    linkage = {"samples": {"SAMEA1"}, "runs": set()}
    stats = phase_analyses.run(tmp_path, log, linkage, get=get, max_pages=1)
    assert read_keys(tmp_path / "analyses.jsonl.gz") == {"MGYA1"}


def test_extras_max_pages_caps_each_subcrawl(tmp_path):
    get = extras_get(_full_collections(), _full_details())
    log = ResumeLog(str(tmp_path / "crawl.sqlite"))
    stats = phase_extras.run(tmp_path, log, get=get, max_pages=1)
    assert read_keys(tmp_path / "genomes.jsonl.gz") == {"MGYG1"}
    assert read_keys(tmp_path / "biomes.jsonl.gz") == {"root"}
