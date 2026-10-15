"""Tests for the in-place MGnify-v2 patch SQL generator (tools/patch_mgnify_v2.py),
which only writes SQL and never opens a DB. These pin the generated SQL's structure
against a tmp dir of empty-but-present TSVs.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

from scripts.populator.schema import TABLES
from scripts.populator.tools import patch_mgnify_v2 as P


ALL_TSVS = [
    "data_sources", "samples", "studies", "assemblies", "runs", "analyses",
    "biomes", "sample_assemblies", "run_assemblies", "sample_runs",
    "run_studies", "sample_analyses", "assembly_analyses", "run_analyses",
    "sample_biomes", "mgnify_publications", "mgnify_super_studies",
    "mgnify_genome_catalogues", "mgnify_genomes",
]

EXPECTED_JUNCTION_SCOPE = {
    "sample_assemblies": ("assemblies", "assembly_id"),
    "sample_runs":       ("runs", "run_id"),
    "run_assemblies":    ("runs", "run_id"),
    "run_analyses":      ("runs", "run_id"),
    "run_studies":       ("runs", "run_id"),
    "sample_analyses":   ("analyses", "analysis_id"),
    "sample_biomes":     ("samples", "sample_id"),
}


def _make_tsv_dir(tmp_path: Path, tables=ALL_TSVS) -> Path:
    d = tmp_path / "populator-out-mgnify-v2"
    d.mkdir()
    for t in tables:
        (d / f"{t}.tsv").write_text("")
    return d


def _generate(tmp_path: Path, tables=ALL_TSVS) -> str:
    d = _make_tsv_dir(tmp_path, tables)
    out = d / "patch_mgnify_v2.sql"
    P.main(["--tsv-dir", str(d), "--out", str(out)])
    return out.read_text()


def test_one_transaction_begin_commit(tmp_path):
    sql = _generate(tmp_path)
    body = sql.strip()
    first = next(l for l in body.splitlines() if l.strip() and not l.strip().startswith("--"))
    last = [l for l in body.splitlines() if l.strip() and not l.strip().startswith("--")][-1]
    assert first.strip() == "BEGIN;"
    assert last.strip() == "COMMIT;"
    assert body.count("BEGIN;") == 1
    assert body.count("COMMIT;") == 1


def test_header_comment_mentions_migration_0048_and_strategy(tmp_path):
    sql = _generate(tmp_path)
    assert "0048" in sql
    assert sql.lstrip().startswith("--")


def test_temp_table_and_copy_per_present_tsv(tmp_path):
    sql = _generate(tmp_path)
    for t in ALL_TSVS:
        assert f"CREATE TEMP TABLE tmp_{t} (LIKE {t} INCLUDING DEFAULTS) ON COMMIT DROP;" in sql
        cols = ", ".join(TABLES[t].columns)
        assert rf"\copy tmp_{t} ({cols}) FROM" in sql
        assert r"WITH (FORMAT text, NULL '\N');" in sql


def test_all_temps_loaded_before_any_upsert_or_junction_step(tmp_path):
    sql = _generate(tmp_path)
    last_create = max(sql.index(f"CREATE TEMP TABLE tmp_{t} ") for t in ALL_TSVS)
    first_insert = sql.index("INSERT INTO ")
    assert last_create < first_insert, "all CREATE TEMP TABLEs must precede the first INSERT"


ENTITY_TABLES = [
    "samples", "studies", "assemblies", "analyses", "runs", "biomes",
    "mgnify_publications", "mgnify_super_studies", "mgnify_genome_catalogues",
    "mgnify_genomes",
]


@pytest.mark.parametrize("t", ENTITY_TABLES)
def test_entity_tables_upsert_on_conflict_id_do_update(tmp_path, t):
    sql = _generate(tmp_path)
    cols = ", ".join(TABLES[t].columns)
    assert f"INSERT INTO {t} ({cols})\n  SELECT {cols} FROM tmp_{t}" in sql
    block = _insert_block(sql, t)
    assert "ON CONFLICT (id) DO UPDATE SET" in block


@pytest.mark.parametrize("t", ENTITY_TABLES)
def test_entity_update_set_omits_id(tmp_path, t):
    sql = _generate(tmp_path)
    block = _insert_block(sql, t)
    set_clause = block.split("DO UPDATE SET", 1)[1]
    assigned = re.findall(r"(\w+)\s*=\s*EXCLUDED\.", set_clause)
    assert "id" not in assigned
    for c in TABLES[t].columns:
        if c == "id":
            continue
        assert f"{c} = EXCLUDED.{c}" in set_clause


def test_data_sources_is_do_nothing(tmp_path):
    sql = _generate(tmp_path)
    block = _insert_block(sql, "data_sources")
    assert "ON CONFLICT (id) DO NOTHING" in block
    assert "DO UPDATE" not in block


@pytest.mark.parametrize("junction,scope", list(EXPECTED_JUNCTION_SCOPE.items()))
def test_scoped_junction_delete_then_insert(tmp_path, junction, scope):
    scope_tmp, scope_col = scope
    sql = _generate(tmp_path)
    delete = (f"DELETE FROM {junction} WHERE {scope_col} "
              f"IN (SELECT id FROM tmp_{scope_tmp});")
    assert delete in sql
    cols = ", ".join(TABLES[junction].columns)
    insert = f"INSERT INTO {junction} ({cols})\n  SELECT {cols} FROM tmp_{junction}"
    assert insert in sql
    assert sql.index(delete) < sql.index(insert)


def test_junction_scope_mapping_is_exactly_the_seven(tmp_path):
    assert P.JUNCTION_SCOPE == EXPECTED_JUNCTION_SCOPE


def test_assembly_analyses_additive_no_delete_do_nothing(tmp_path):
    sql = _generate(tmp_path)
    assert "DELETE FROM assembly_analyses" not in sql
    block = _insert_block(sql, "assembly_analyses")
    assert "DO NOTHING" in block
    assert "DO UPDATE" not in block
    assert "assembly_analyses" not in P.JUNCTION_SCOPE


def test_missing_tsv_produces_no_steps(tmp_path):
    present = [t for t in ALL_TSVS if t != "studies"]
    sql = _generate(tmp_path, tables=present)
    assert "tmp_studies" not in sql
    assert "INSERT INTO studies " not in sql
    assert "CREATE TEMP TABLE tmp_studies" not in sql
    assert "tmp_samples" in sql


def test_missing_junction_tsv_skips_its_delete(tmp_path):
    present = [t for t in ALL_TSVS if t != "sample_biomes"]
    sql = _generate(tmp_path, tables=present)
    assert "DELETE FROM sample_biomes" not in sql
    assert "INSERT INTO sample_biomes" not in sql


def test_main_writes_sql_and_returns_zero(tmp_path, capsys):
    d = _make_tsv_dir(tmp_path)
    out = d / "patch.sql"
    rc = P.main(["--tsv-dir", str(d), "--out", str(out)])
    assert rc == 0
    assert out.exists()
    printed = capsys.readouterr().out
    assert str(out) in printed


def test_main_default_out_is_in_tsv_dir(tmp_path):
    d = _make_tsv_dir(tmp_path)
    rc = P.main(["--tsv-dir", str(d)])
    assert rc == 0
    assert (d / "patch_mgnify_v2.sql").exists()


def _insert_block(sql: str, table: str) -> str:
    """The ``INSERT INTO <table> (...)`` statement up to its ``;``."""
    marker = f"INSERT INTO {table} ("
    start = sql.index(marker)
    end = sql.index(";", start)
    return sql[start:end + 1]
