"""Tests for tools/emit_mgnify_v2.py, which re-runs the populator's metadata pass from
the native-v2 JSONL bundles (no BGC pass), against a tiny fixture bundle dir. No ceph,
no DB.
"""
import gzip
import json
from pathlib import Path

from scripts.populator import ids
from scripts.populator.tools.emit_mgnify_v2 import main


# The deterministic MGnify data_sources id (== entity_id("data_sources","MGnify")).
MGNIFY_DS_ID = "27a9fa9d-2762-5e68-9fbe-0025002ce203"


def _write_bundle(path: Path, records) -> None:
    """Write v2 ``data`` dicts as gzip JSONL in the crawler's wrapper shape."""
    with gzip.open(path, "wt", encoding="utf-8") as fh:
        for data in records:
            key = (data.get("accession") or data.get("slug")
                   or data.get("catalogue_id") or str(data.get("pubmed_id")))
            fh.write(json.dumps({"_v2_endpoint": path.stem.split(".")[0],
                                 "_key": key, "data": data}) + "\n")


def _make_bundles(d: Path) -> Path:
    """A minimal v2 bundle dir. ERZ2's run is absent, so its run_assemblies must be
    dropped as dangling; the genome is FK-linked to the catalogue."""
    b = d / "mgnify_asms_v2"
    b.mkdir(parents=True, exist_ok=True)

    samples = [{
        "accession": "SAMEA1",
        "ena_accessions": ["SAMEA1", "ERS1"],
        "sample_title": "fixture sample",
        "updated_at": "2026-01-01T00:00:00Z",
        "biome": {"lineage": "root:Environmental:Aquatic"},
        "metadata": {"lat": "1.5", "lon": "2.5", "country": "Nowhere"},
    }]
    assemblies = [
        {  # links to PRESENT run ERR1 + PRESENT sample SAMEA1 -> kept junctions
            "accession": "ERZ1", "run_accession": "ERR1",
            "sample_accession": "SAMEA1", "status": "ok",
        },
        {  # links to ABSENT run ERR_MISSING -> its run_assemblies must be dropped
            "accession": "ERZ2", "run_accession": "ERR_MISSING",
            "sample_accession": "SAMEA1", "status": "ok",
        },
    ]
    runs = [{
        "accession": "ERR1", "study_accession": "MGYS1",
        "sample_accession": "SAMEA1", "instrument_model": "MiSeq",
    }]
    studies = [{"accession": "MGYS1", "title": "fixture study"}]
    analyses = [{
        "accession": "MGYA1", "experiment_type": "metagenomic",
        "sample": {"accession": "SAMEA1"}, "assembly": {"accession": "ERZ1"},
        "run": {"accession": "ERR1"},
    }]
    publications = [{"pubmed_id": 12345, "title": "fixture pub",
                     "published_year": 2020}]
    super_studies = [{"slug": "fixture-ss", "title": "fixture super study"}]
    genome_catalogues = [{"catalogue_id": "cat-1", "name": "fixture catalogue",
                          "version": "1.0", "genome_count": 1}]
    genomes = [{"accession": "MGYG1", "catalogue_id": "cat-1",
                "length": 1000, "completeness": "99.5"}]

    _write_bundle(b / "samples.jsonl.gz", samples)
    _write_bundle(b / "assemblies.jsonl.gz", assemblies)
    _write_bundle(b / "runs.jsonl.gz", runs)
    _write_bundle(b / "studies.jsonl.gz", studies)
    _write_bundle(b / "analyses.jsonl.gz", analyses)
    _write_bundle(b / "publications.jsonl.gz", publications)
    _write_bundle(b / "super_studies.jsonl.gz", super_studies)
    _write_bundle(b / "genome_catalogues.jsonl.gz", genome_catalogues)
    _write_bundle(b / "genomes.jsonl.gz", genomes)
    return b


def _read_tsv(path: Path):
    return [line.split("\t") for line in
            path.read_text().splitlines() if line]


def test_emit_writes_expected_tsvs_and_resolves_provenance(tmp_path):
    bundles = _make_bundles(tmp_path)
    out = tmp_path / "out"

    rc = main(["--bundles", str(bundles), "--out", str(out)])
    assert rc == 0

    for name in ("samples", "assemblies", "runs", "studies", "analyses",
                 "biomes", "data_sources",
                 "sample_assemblies", "run_assemblies", "run_studies",
                 "sample_runs", "sample_analyses", "assembly_analyses",
                 "run_analyses", "sample_biomes",
                 "mgnify_publications", "mgnify_super_studies",
                 "mgnify_genome_catalogues", "mgnify_genomes"):
        assert (out / f"{name}.tsv").exists(), f"missing {name}.tsv"

    ds_rows = _read_tsv(out / "data_sources.tsv")
    assert any(r[0] == MGNIFY_DS_ID for r in ds_rows), ds_rows

    sample_cols = list(_table_columns("samples"))
    sample_rows = _read_tsv(out / "samples.tsv")
    assert len(sample_rows) == 1
    row = dict(zip(sample_cols, sample_rows[0]))
    assert row["id"] == str(ids.entity_id("samples", "mgnify|ERS1"))
    assert row["external_id"] == "ERS1"
    assert MGNIFY_DS_ID in row["data_source_ids"]


def test_dangling_junction_dropped_present_kept(tmp_path):
    bundles = _make_bundles(tmp_path)
    out = tmp_path / "out"
    assert main(["--bundles", str(bundles), "--out", str(out)]) == 0

    ra_rows = _read_tsv(out / "run_assemblies.tsv")
    assert len(ra_rows) == 1, ra_rows
    err1 = str(ids.entity_id("runs", "mgnify|ERR1"))
    erz1 = str(ids.entity_id("assemblies", "mgnify|ERZ1"))
    assert ra_rows[0][0] == err1 and ra_rows[0][1] == erz1
    err_missing = str(ids.entity_id("runs", "mgnify|ERR_MISSING"))
    assert all(err_missing not in r for r in ra_rows)


def test_newtypes_and_genome_catalogue_fk(tmp_path):
    bundles = _make_bundles(tmp_path)
    out = tmp_path / "out"
    assert main(["--bundles", str(bundles), "--out", str(out)]) == 0

    genome_cols = list(_table_columns("mgnify_genomes"))
    grows = _read_tsv(out / "mgnify_genomes.tsv")
    assert len(grows) == 1
    grow = dict(zip(genome_cols, grows[0]))
    expected_cat = str(ids.entity_id("mgnify_genome_catalogues", "mgnify|cat-1"))
    assert grow["genome_catalogue_id"] == expected_cat

    assert len(_read_tsv(out / "mgnify_genome_catalogues.tsv")) == 1
    assert len(_read_tsv(out / "mgnify_super_studies.tsv")) == 1
    assert len(_read_tsv(out / "mgnify_publications.tsv")) == 1


def test_manifest_written(tmp_path):
    bundles = _make_bundles(tmp_path)
    out = tmp_path / "out"
    assert main(["--bundles", str(bundles), "--out", str(out)]) == 0
    manifest = json.loads((out / "manifest.json").read_text())
    assert "tables" in manifest
    assert manifest["tables"]["samples"]["row_count"] == 1


def _table_columns(name: str):
    from scripts.populator.schema import TABLES
    return TABLES[name].columns
