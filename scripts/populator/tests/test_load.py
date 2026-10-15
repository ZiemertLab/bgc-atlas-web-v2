import pytest
from scripts.populator import load


def test_ordered_parquet_is_fk_safe(tmp_path):
    for t in ["bgcs", "assemblies", "taxonomies", "samples", "data_sources", "analyses"]:
        (tmp_path / f"{t}.parquet").write_bytes(b"")
    order = load.ordered_parquet(tmp_path)
    assert order.index("assemblies") < order.index("bgcs")
    assert order.index("data_sources") < order.index("samples")
    assert order.index("analyses") < order.index("bgcs")


def test_duckdb_dry_run_plan(tmp_path):
    (tmp_path / "data_sources.parquet").write_bytes(b"")
    res = load.duckdb_load(tmp_path, ":memory:", execute=False)
    assert res["order"] == ["data_sources"]
    assert any("read_parquet" in s for s in res["plan"])


def test_postgres_script_uses_tsv_when_present(tmp_path):
    (tmp_path / "data_sources.parquet").write_bytes(b"")
    (tmp_path / "data_sources.tsv").write_text("u1\tthird_party\tDS_x\t\\N\t\\N\t\\N\n")
    res = load.postgres_script(tmp_path, execute=False)
    assert r"\copy data_sources" in res["script"]
    assert "BEGIN;" in res["script"] and "COMMIT;" in res["script"]


def test_postgres_execute_is_refused(tmp_path):
    with pytest.raises(SystemExit):
        load.postgres_script(tmp_path, execute=True)


def test_paths_with_apostrophe_are_escaped(tmp_path):
    d = tmp_path / "o'dir"; d.mkdir()
    (d / "data_sources.parquet").write_bytes(b"")
    res = load.duckdb_load(d, ":memory:", execute=False)
    assert "o''dir" in res["plan"][0]


def test_duckdb_loads_real_fram_output(tmp_path):
    import pathlib, polars as pl
    base = pathlib.Path("/data/bgc-atlas/data-v2/populator-out/custom_fram_ras")
    if not (base / "bgcs.parquet").exists():
        pytest.skip("fram_ras output not present")
    res = load.duckdb_load(base, str(tmp_path / "smoke.duckdb"), execute=True)
    # self-relative counts, so the test survives re-runs and limits
    assert res["counts"], "expected some tables loaded"
    for t, cnt in res["counts"].items():
        assert cnt == pl.read_parquet(base / f"{t}.parquet").height, f"count mismatch for {t}"
    assert res["counts"].get("bgcs", 0) > 0
    import duckdb
    con = duckdb.connect(str(tmp_path / "smoke.duckdb"))
    orphans = con.execute("SELECT count(*) FROM bgcs b LEFT JOIN assemblies a "
                          "ON b.assembly=a.id WHERE a.id IS NULL").fetchone()[0]
    con.close()
    assert orphans == 0


def test_table_files_picks_up_streamed_bgcs_parts(tmp_path):
    for n in (0, 1):
        (tmp_path / f"bgcs_{n:04d}.parquet").write_bytes(b"")
    files = load.table_files(tmp_path, "bgcs")
    assert [f.name for f in files] == ["bgcs_0000.parquet", "bgcs_0001.parquet"]
    assert "bgcs" in load.ordered_parquet(tmp_path)


def test_table_files_no_prefix_collision(tmp_path):
    # the _[0-9] boundary keeps 'samples' from matching 'sample_assemblies'
    (tmp_path / "samples.parquet").write_bytes(b"")
    (tmp_path / "sample_assemblies.parquet").write_bytes(b"")
    assert [f.name for f in load.table_files(tmp_path, "samples")] == ["samples.parquet"]
    assert [f.name for f in load.table_files(tmp_path, "sample_assemblies")] == ["sample_assemblies.parquet"]


def test_duckdb_plan_reads_all_bgcs_parts(tmp_path):
    for n in (0, 1):
        (tmp_path / f"bgcs_{n:04d}.parquet").write_bytes(b"")
    res = load.duckdb_load(tmp_path, ":memory:", execute=False)
    plan = "\n".join(res["plan"])
    assert "bgcs_0000.parquet" in plan and "bgcs_0001.parquet" in plan


def test_postgres_script_one_copy_per_bgcs_part(tmp_path):
    for n in (0, 1):
        (tmp_path / f"bgcs_{n:04d}.parquet").write_bytes(b"")
        (tmp_path / f"bgcs_{n:04d}.tsv").write_text("x\n")
    script = load.postgres_script(tmp_path, execute=False)["script"]
    assert script.count(r"\copy bgcs") == 2
