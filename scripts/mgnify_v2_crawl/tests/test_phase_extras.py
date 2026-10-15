"""Tests for phase D: biomes, publications, super_studies, genome_catalogues, genomes."""

import gzip
import json

from scripts.mgnify_v2_crawl import phase_extras
from scripts.mgnify_v2_crawl.client import CrawlError
from scripts.mgnify_v2_crawl.state import ResumeLog
from scripts.mgnify_v2_crawl.writer import read_keys


def make_get(collections, details=None, raise_paths=()):
    """Lists are re-paged by the requested page_size; GETs of `raise_paths` raise CrawlError."""
    details = details or {}
    raise_paths = set(raise_paths)

    def fake_get(path, params=None, **kwargs):
        if path in raise_paths:
            raise CrawlError(f"boom: {path}")
        if path in collections:
            items = collections[path]
            params = params or {}
            page = params.get("page", 1)
            size = params.get("page_size", len(items) or 1)
            start = (page - 1) * size
            return {"count": len(items), "items": items[start:start + size]}
        return details.get(path, None)

    return fake_get


def _full_collections():
    return {
        "biomes/": [
            {"lineage": "root", "biome_name": "root"},
            {"lineage": "root:Host-associated", "biome_name": "Host-associated"},
        ],
        "publications/": [
            {"pubmed_id": 111, "title": "P1"},
            {"pubmed_id": 222, "title": "P2"},
        ],
        "super-studies/": [
            {"slug": "ss-a", "title": "A"},
            {"slug": "ss-b", "title": "B"},
        ],
        "genomes/catalogues/": [
            {"catalogue_id": "cat-1", "name": "Cat 1"},
            {"catalogue_id": "cat-2", "name": "Cat 2"},
        ],
        "genomes/": [
            {"accession": "MGYG1"},
            {"accession": "MGYG2"},
            {"accession": "MGYG3"},
        ],
    }


def _full_details():
    return {
        "super-studies/ss-a": {"slug": "ss-a", "flagship_studies": []},
        "super-studies/ss-b": {"slug": "ss-b", "flagship_studies": []},
        "genomes/catalogues/cat-1": {"catalogue_id": "cat-1", "genome_count": 10},
        "genomes/catalogues/cat-2": {"catalogue_id": "cat-2", "genome_count": 20},
    }


def test_all_subtypes_written_with_correct_keys(tmp_path):
    get = make_get(_full_collections(), _full_details())
    log = ResumeLog(str(tmp_path / "crawl.sqlite"))
    stats = phase_extras.run(tmp_path, log, get=get)

    assert read_keys(tmp_path / "biomes.jsonl.gz") == {"root", "root:Host-associated"}
    assert read_keys(tmp_path / "publications.jsonl.gz") == {"111", "222"}
    assert read_keys(tmp_path / "super_studies.jsonl.gz") == {"ss-a", "ss-b"}
    assert read_keys(tmp_path / "genome_catalogues.jsonl.gz") == {"cat-1", "cat-2"}
    assert read_keys(tmp_path / "genomes.jsonl.gz") == {"MGYG1", "MGYG2", "MGYG3"}

    assert stats["biomes"]["written"] == 2
    assert stats["publications"]["written"] == 2
    assert stats["super_studies"]["written"] == 2
    assert stats["genome_catalogues"]["written"] == 2
    assert stats["genomes"]["written"] == 3


def test_list_subtypes_store_raw_item_as_data(tmp_path):
    get = make_get(_full_collections(), _full_details())
    log = ResumeLog(str(tmp_path / "crawl.sqlite"))
    phase_extras.run(tmp_path, log, get=get)
    with gzip.open(tmp_path / "biomes.jsonl.gz", "rt", encoding="utf-8") as fh:
        first = json.loads(fh.readline())
    assert first["_key"] == "root"
    assert first["data"] == {"lineage": "root", "biome_name": "root"}
    assert first["_v2_endpoint"].endswith("biomes/")


def test_one_failing_subtype_does_not_abort_others(tmp_path):
    get = make_get(_full_collections(), _full_details(), raise_paths={"publications/"})
    log = ResumeLog(str(tmp_path / "crawl.sqlite"))
    stats = phase_extras.run(tmp_path, log, get=get)

    assert read_keys(tmp_path / "biomes.jsonl.gz") == {"root", "root:Host-associated"}
    assert read_keys(tmp_path / "genomes.jsonl.gz") == {"MGYG1", "MGYG2", "MGYG3"}
    assert read_keys(tmp_path / "super_studies.jsonl.gz") == {"ss-a", "ss-b"}
    assert read_keys(tmp_path / "genome_catalogues.jsonl.gz") == {"cat-1", "cat-2"}
    assert "error" in stats["publications"]


def test_list_subtype_skips_keys_already_on_disk(tmp_path):
    from scripts.mgnify_v2_crawl.writer import BundleWriter

    pre = BundleWriter(tmp_path, "biomes")
    pre.write("root", "u", {"lineage": "root"})
    pre.finalize()

    get = make_get(_full_collections(), _full_details())
    log = ResumeLog(str(tmp_path / "crawl.sqlite"))
    stats = phase_extras.run(tmp_path, log, get=get)
    assert stats["biomes"]["written"] == 1
    assert stats["biomes"]["skipped"] == 1
    assert read_keys(tmp_path / "biomes.jsonl.gz") == {"root", "root:Host-associated"}


def test_rerun_is_no_op(tmp_path):
    get = make_get(_full_collections(), _full_details())
    log = ResumeLog(str(tmp_path / "crawl.sqlite"))
    phase_extras.run(tmp_path, log, get=get)
    stats2 = phase_extras.run(tmp_path, log, get=get)
    assert stats2["biomes"]["written"] == 0
    assert stats2["publications"]["written"] == 0
    assert stats2["super_studies"]["written"] == 0
    assert stats2["genome_catalogues"]["written"] == 0
    assert stats2["genomes"]["written"] == 0
    assert read_keys(tmp_path / "genomes.jsonl.gz") == {"MGYG1", "MGYG2", "MGYG3"}


def test_malformed_list_item_skipped_not_wedged(tmp_path):
    # One item lacks its key_field (`lineage`): it is skipped and counted, never wedging reruns.
    cols = _full_collections()
    cols["biomes/"] = [
        {"lineage": "root", "biome_name": "root"},
        {"biome_name": "no-lineage-here"},  # malformed: missing key_field
        {"lineage": "root:Engineered", "biome_name": "Engineered"},
    ]
    get = make_get(cols, _full_details())
    log = ResumeLog(str(tmp_path / "crawl.sqlite"))
    stats = phase_extras.run(tmp_path, log, get=get)

    assert read_keys(tmp_path / "biomes.jsonl.gz") == {"root", "root:Engineered"}
    assert stats["biomes"]["written"] == 2
    assert stats["biomes"]["skipped_malformed"] == 1
    assert "error" not in stats["biomes"]

    stats2 = phase_extras.run(tmp_path, log, get=get)
    assert stats2["biomes"]["written"] == 0
    assert stats2["biomes"]["skipped_malformed"] == 1
    assert read_keys(tmp_path / "biomes.jsonl.gz") == {"root", "root:Engineered"}


def test_super_study_404_handled(tmp_path):
    cols = _full_collections()
    details = _full_details()
    details["super-studies/ss-b"] = None  # 404 on detail
    get = make_get(cols, details)
    log = ResumeLog(str(tmp_path / "crawl.sqlite"))
    stats = phase_extras.run(tmp_path, log, get=get)
    assert stats["super_studies"]["removed"] == 1
    assert read_keys(tmp_path / "super_studies.jsonl.gz") == {"ss-a"}
