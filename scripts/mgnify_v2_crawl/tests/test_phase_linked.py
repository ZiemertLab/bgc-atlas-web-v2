"""Tests for phase B: detail-fetch the linked samples / runs / studies."""

from scripts.mgnify_v2_crawl import phase_linked
from scripts.mgnify_v2_crawl.client import CrawlError
from scripts.mgnify_v2_crawl.state import ResumeLog
from scripts.mgnify_v2_crawl.writer import read_keys


def make_get(details):
    """Fake `get` mapping any detail path -> dict / None / raised error."""
    def fake_get(path, params=None, **kwargs):
        result = details.get(path, None)
        if isinstance(result, BaseException):
            raise result
        return result

    return fake_get


def test_each_type_fetched_into_its_bundle(tmp_path):
    linkage = {
        "samples": {"SAMEA1", "SAMEA2"},
        "runs": {"ERR1"},
        "studies": {"MGYS1"},
    }
    details = {
        "samples/SAMEA1": {"accession": "SAMEA1", "lat": 1.0},
        "samples/SAMEA2": {"accession": "SAMEA2", "lat": 2.0},
        "runs/ERR1": {"accession": "ERR1"},
        "studies/MGYS1": {"accession": "MGYS1"},
    }
    get = make_get(details)
    log = ResumeLog(str(tmp_path / "crawl.sqlite"))
    stats = phase_linked.run(tmp_path, log, linkage, get=get)

    assert set(stats) == {"samples", "runs", "studies"}
    assert read_keys(tmp_path / "samples.jsonl.gz") == {"SAMEA1", "SAMEA2"}
    assert read_keys(tmp_path / "runs.jsonl.gz") == {"ERR1"}
    assert read_keys(tmp_path / "studies.jsonl.gz") == {"MGYS1"}
    assert stats["samples"]["written"] == 2
    assert stats["runs"]["written"] == 1
    assert stats["studies"]["written"] == 1


def test_keys_are_the_linkage_accessions(tmp_path):
    import gzip
    import json
    from scripts.mgnify_v2_crawl import config

    linkage = {"samples": {"SAMEA9"}, "runs": set(), "studies": set()}
    details = {"samples/SAMEA9": {"accession": "SAMEA9", "ena_accessions": ["ERS9"]}}
    get = make_get(details)
    log = ResumeLog(str(tmp_path / "crawl.sqlite"))
    phase_linked.run(tmp_path, log, linkage, get=get)
    with gzip.open(tmp_path / "samples.jsonl.gz", "rt", encoding="utf-8") as fh:
        line = json.loads(fh.readline())
    assert line["_key"] == "SAMEA9"
    assert line["_v2_endpoint"] == config.BASE_URL + "samples/SAMEA9"


def test_404_handled_per_type(tmp_path):
    linkage = {"samples": {"SAMEA1", "GONE"}, "runs": set(), "studies": set()}
    details = {
        "samples/SAMEA1": {"accession": "SAMEA1"},
        "samples/GONE": None,  # 404
    }
    get = make_get(details)
    log = ResumeLog(str(tmp_path / "crawl.sqlite"))
    stats = phase_linked.run(tmp_path, log, linkage, get=get)
    assert stats["samples"]["removed"] == 1
    assert read_keys(tmp_path / "samples.jsonl.gz") == {"SAMEA1"}


def test_empty_linkage_sets_finalize_empty_bundles(tmp_path):
    linkage = {"samples": set(), "runs": set(), "studies": set()}
    get = make_get({})
    log = ResumeLog(str(tmp_path / "crawl.sqlite"))
    stats = phase_linked.run(tmp_path, log, linkage, get=get)
    for t in ("samples", "runs", "studies"):
        assert (tmp_path / f"{t}.jsonl.gz").exists()
        assert read_keys(tmp_path / f"{t}.jsonl.gz") == set()
        assert stats[t]["requested"] == 0


def test_crawl_error_counted_per_type(tmp_path):
    linkage = {"samples": {"SAMEA1", "BAD"}, "runs": set(), "studies": set()}
    details = {
        "samples/SAMEA1": {"accession": "SAMEA1"},
        "samples/BAD": CrawlError("boom"),
    }
    get = make_get(details)
    log = ResumeLog(str(tmp_path / "crawl.sqlite"))
    stats = phase_linked.run(tmp_path, log, linkage, get=get)
    assert stats["samples"]["errors"] == 1
    assert read_keys(tmp_path / "samples.jsonl.gz") == {"SAMEA1"}
