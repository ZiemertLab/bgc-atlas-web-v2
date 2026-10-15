"""Tests for the coverage report generator; fixtures are tiny files under tmp_path."""

import io
import json
import tarfile

from scripts.mgnify_v2_crawl import config, report
from scripts.mgnify_v2_crawl.state import ResumeLog
from scripts.mgnify_v2_crawl.writer import BundleWriter


def _make_v1_tar(path, members):
    with tarfile.open(path, "w:gz") as tf:
        for name, obj in members.items():
            payload = json.dumps(obj).encode("utf-8")
            info = tarfile.TarInfo(name=name)
            info.size = len(payload)
            tf.addfile(info, io.BytesIO(payload))


def _v1_sample(accession, lat, lon):
    return {
        "type": "samples",
        "id": accession,
        "attributes": {"latitude": lat, "longitude": lon},
    }


def _make_v2_samples(path, records):
    w = BundleWriter(path.parent, "samples")
    for data in records:
        w.write(data.get("accession", "k"), config.BASE_URL + "samples/", data)
    w.finalize()


def _v2_sample(accession, ena_accessions, lat, lon):
    return {
        "accession": accession,
        "ena_accessions": list(ena_accessions),
        "metadata": {"lat": lat, "lon": lon},
    }


def test_config_has_v1_dump_dir():
    from pathlib import Path
    assert config.V1_DUMP_DIR == Path(
        "/data/bgc-atlas/data-v2/metadata/mgnify_asms"
    )


def test_count_v1_members_counts_only_json(tmp_path):
    tar = tmp_path / "samples.tar.gz"
    _make_v1_tar(tar, {
        "samples/ERS1.json": _v1_sample("ERS1", "1.0", "2.0"),
        "samples/ERS2.json": _v1_sample("ERS2", None, None),
        "samples/README.txt": {"ignore": True},  # not .json -> not counted
    })
    assert report.count_v1_members(tar) == 2


def test_v1_samples_without_latlon_picks_null_and_empty(tmp_path):
    tar = tmp_path / "samples.tar.gz"
    _make_v1_tar(tar, {
        "samples/ERS_HAS.json": _v1_sample("ERS_HAS", "12.97", "77.59"),
        "samples/ERS_NULL.json": _v1_sample("ERS_NULL", None, None),
        "samples/ERS_EMPTY.json": _v1_sample("ERS_EMPTY", "", ""),
        "samples/ERS_HALF.json": _v1_sample("ERS_HALF", "5.0", None),  # one missing
    })
    missing = report.v1_samples_without_latlon(tar)
    assert missing == {"ERS_NULL", "ERS_EMPTY", "ERS_HALF"}
    assert "ERS_HAS" not in missing


def test_v2_index_maps_each_ena_accession_to_has_latlon(tmp_path):
    bundle = tmp_path / "samples.jsonl.gz"
    _make_v2_samples(bundle, [
        _v2_sample("SAMEA1", ["SAMEA1", "ERS_NULL"], "10.0", "20.0"),  # has coords
        _v2_sample("SAMEA2", ["SAMEA2", "ERS_OTHER"], "", ""),         # no coords
    ])
    idx = report.v2_samples_latlon_index(bundle)
    assert idx["ERS_NULL"] is True
    assert idx["SAMEA1"] is True
    assert idx["ERS_OTHER"] is False
    assert idx["SAMEA2"] is False


def test_samples_gained_latlon_counts_v1_null_now_in_v2(tmp_path):
    v1_no_latlon = {"ERS_GAINED", "ERS_STILL", "ERS_UNKNOWN"}
    # v2 index: ERS_GAINED now has coords; ERS_STILL still doesn't; ERS_UNKNOWN absent.
    v2_index = {
        "ERS_GAINED": True,
        "SAMEA_G": True,
        "ERS_STILL": False,
        "SAMEA_S": False,
    }
    gained = report.samples_gained_latlon(v1_no_latlon, v2_index)
    assert gained == 1


def test_write_report_emits_markdown_with_headline_and_table(tmp_path):
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    v1_dir = tmp_path / "v1"
    v1_dir.mkdir()

    _make_v1_tar(v1_dir / "samples.tar.gz", {
        "samples/ERS_GAINED.json": _v1_sample("ERS_GAINED", None, None),
        "samples/ERS_HAS.json": _v1_sample("ERS_HAS", "1.0", "2.0"),
    })
    _make_v1_tar(v1_dir / "assemblies.tar.gz", {
        "assemblies/ERZ1.json": {"type": "assemblies", "id": "ERZ1"},
    })
    _make_v1_tar(v1_dir / "runs.tar.gz", {})
    _make_v1_tar(v1_dir / "studies.tar.gz", {})
    _make_v1_tar(v1_dir / "analyses.tar.gz", {})

    # v2 joins ERS_GAINED to a record with coordinates.
    _make_v2_samples(out_dir / "samples.jsonl.gz", [
        _v2_sample("SAMEA_G", ["SAMEA_G", "ERS_GAINED"], "10.0", "20.0"),
        _v2_sample("SAMEA_H", ["SAMEA_H", "ERS_HAS"], "1.0", "2.0"),
    ])
    aw = BundleWriter(out_dir, "assemblies")
    aw.write("ERZ1", config.BASE_URL + "assemblies/ERZ1", {"accession": "ERZ1"})
    aw.write("ERZ2", config.BASE_URL + "assemblies/ERZ2", {"accession": "ERZ2"})
    aw.finalize()

    log = ResumeLog(str(out_dir / "_state" / "crawl.sqlite"))
    log.mark("assemblies", "ERZGONE", "removed", 404)
    log.mark("samples", "SAMEABAD", "error")
    log.mark("assemblies", "ERZ1", "ok", 200)  # ok rows must not count as removed/error

    stats = {
        "assemblies": {"requested": 2, "written": 2, "removed": 1, "errors": 0, "skipped": 0},
        "samples": {"requested": 2, "written": 2, "removed": 0, "errors": 1, "skipped": 0},
    }

    path = report.write_report(out_dir, v1_dir, stats, log)
    assert path == out_dir / "_report" / "coverage.md"
    assert path.exists()
    text = path.read_text()

    assert "1" in text
    assert "lat" in text.lower() and "lon" in text.lower()
    assert "samples" in text
    assert "assemblies" in text
    assert "| samples |" in text or "samples" in text
    assert "removed" in text.lower()
    assert "error" in text.lower()


def test_write_report_handles_missing_v1_tar(tmp_path):
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    v1_dir = tmp_path / "v1"
    v1_dir.mkdir()
    _make_v1_tar(v1_dir / "samples.tar.gz", {
        "samples/ERS1.json": _v1_sample("ERS1", "1.0", "2.0"),
    })
    _make_v2_samples(out_dir / "samples.jsonl.gz", [
        _v2_sample("SAMEA1", ["SAMEA1", "ERS1"], "1.0", "2.0"),
    ])
    log = ResumeLog(str(out_dir / "_state" / "crawl.sqlite"))
    path = report.write_report(out_dir, v1_dir, {}, log)
    assert path.exists()
