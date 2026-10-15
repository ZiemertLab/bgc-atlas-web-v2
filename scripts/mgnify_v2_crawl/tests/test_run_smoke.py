"""Smoke tests for the orchestrator CLI; every phase is replaced by a recording fake."""

import json

import pytest

from scripts.mgnify_v2_crawl import run


@pytest.fixture
def fakes(monkeypatch):
    calls = []

    def fake_assemblies(out_dir, resume, *, get=None, max_pages=None):
        calls.append(("assemblies", {"max_pages": max_pages}))
        return {"requested": 3, "written": 3, "removed": 0, "errors": 0, "skipped": 0}

    def fake_linkage(out_dir):
        calls.append(("linkage", {}))
        return {"samples": {"S1"}, "runs": {"R1"}, "studies": {"ST1"}}

    def fake_linked(out_dir, resume, linkage, *, get=None):
        calls.append(("linked", {"linkage_keys": sorted(linkage.keys())}))
        return {
            "samples": {"requested": 1, "written": 1, "removed": 0, "errors": 0, "skipped": 0},
            "runs": {"requested": 1, "written": 1, "removed": 0, "errors": 0, "skipped": 0},
            "studies": {"requested": 1, "written": 1, "removed": 0, "errors": 0, "skipped": 0},
        }

    def fake_analyses(out_dir, resume, linkage, *, get=None, max_pages=None):
        calls.append(("analyses", {"max_pages": max_pages, "linkage_keys": sorted(linkage.keys())}))
        return {"requested": 2, "written": 2, "removed": 0, "errors": 0, "skipped": 0}

    def fake_extras(out_dir, resume, *, get=None, max_pages=None):
        calls.append(("extras", {"max_pages": max_pages}))
        return {"genomes": {"requested": 5, "written": 5, "removed": 0, "errors": 0, "skipped": 0}}

    def fake_read_keys(path):
        calls.append(("read_keys", {"path": str(path)}))
        return {"ERZ1", "ERZ2", "ERZ3"}

    def fake_write_report(out_dir, v1_dir, stats, resume):
        calls.append(("report", {"stats_keys": sorted(stats.keys())}))
        from pathlib import Path
        p = Path(out_dir) / "_report" / "coverage.md"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("fake report")
        return p

    monkeypatch.setattr(run.phase_assemblies, "run", fake_assemblies)
    monkeypatch.setattr(run.phase_assemblies, "linkage_from_assemblies", fake_linkage)
    monkeypatch.setattr(run.phase_linked, "run", fake_linked)
    monkeypatch.setattr(run.phase_analyses, "run", fake_analyses)
    monkeypatch.setattr(run.phase_extras, "run", fake_extras)
    monkeypatch.setattr(run.report, "write_report", fake_write_report)
    monkeypatch.setattr(run, "read_keys", fake_read_keys)
    return calls


def _phase_order(calls):
    return [name for name, _ in calls if name in
            {"assemblies", "linked", "analyses", "extras", "report"}]


def test_phase_ordering_all(tmp_path, fakes):
    run.main(["--out", str(tmp_path)])
    assert _phase_order(fakes) == ["assemblies", "linked", "analyses", "extras", "report"]


def test_manifest_written_with_params(tmp_path, fakes):
    run.main(["--out", str(tmp_path), "--concurrency", "4", "--limit-assemblies", "7", "--max-pages", "3"])
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert manifest["params"]["out"] == str(tmp_path)
    assert manifest["params"]["concurrency"] == 4
    assert manifest["params"]["limit_assemblies"] == 7
    assert manifest["params"]["max_pages"] == 3
    assert manifest["params"]["phase"] == "all"
    assert "timestamp" in manifest
    assert manifest["stats"]["assemblies"]["written"] == 3
    assert manifest["stats"]["analyses"]["written"] == 2
    assert manifest["stats"]["extras"]["genomes"]["written"] == 5
    assert "linked" in manifest["stats"]


def test_total_written_aggregated(tmp_path, fakes):
    run.main(["--out", str(tmp_path)])
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    # assemblies 3 + linked (1+1+1) + analyses 2 + extras genomes 5 = 13
    assert manifest["total_written"] == 13


def test_limit_assemblies_threaded_as_max_pages(tmp_path, fakes):
    run.main(["--out", str(tmp_path), "--limit-assemblies", "5"])
    asm = [params for name, params in fakes if name == "assemblies"][0]
    assert asm["max_pages"] == 5


def test_max_pages_threaded_into_analyses_and_extras(tmp_path, fakes):
    run.main(["--out", str(tmp_path), "--max-pages", "9"])
    ana = [params for name, params in fakes if name == "analyses"][0]
    ext = [params for name, params in fakes if name == "extras"][0]
    assert ana["max_pages"] == 9
    assert ext["max_pages"] == 9


def test_single_phase_runs_only_that_phase(tmp_path, fakes):
    run.main(["--out", str(tmp_path), "--phase", "extras"])
    assert _phase_order(fakes) == ["extras"]


def test_single_phase_report_runs_only_report(tmp_path, fakes):
    run.main(["--out", str(tmp_path), "--phase", "report"])
    assert _phase_order(fakes) == ["report"]


def test_single_phase_analyses_builds_linkage(tmp_path, fakes):
    run.main(["--out", str(tmp_path), "--phase", "analyses"])
    order = _phase_order(fakes)
    assert order == ["analyses"]
    ana = [params for name, params in fakes if name == "analyses"][0]
    assert "assemblies" in ana["linkage_keys"]


def test_analyses_linkage_includes_assemblies_set(tmp_path, fakes):
    run.main(["--out", str(tmp_path)])
    ana = [params for name, params in fakes if name == "analyses"][0]
    assert "assemblies" in ana["linkage_keys"]
    assert "samples" in ana["linkage_keys"]
