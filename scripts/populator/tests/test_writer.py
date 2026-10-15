import json
import polars as pl
from scripts.populator.core.writer import write_tables
from scripts.populator.schema import TABLES


def test_writes_parquet_and_manifest(tmp_path):
    tables = {"data_sources": [{"id": "u1", "source_type": "third_party",
                               "name": "DS_x", "description": None,
                               "source_url": None, "user_upload_id": None}]}
    manifest = write_tables(tables, tmp_path, emit_tsv=False, version="0.1.0")
    p = tmp_path / "data_sources.parquet"
    assert p.exists()
    df = pl.read_parquet(p)
    assert df.shape[0] == 1 and df["name"][0] == "DS_x"
    m = json.loads((tmp_path / "manifest.json").read_text())
    assert m["tables"]["data_sources"]["row_count"] == 1
    assert "sha256" in m["tables"]["data_sources"]


def test_writes_empty_table(tmp_path):
    from scripts.populator.core.writer import write_tables
    m = write_tables({"data_sources": []}, tmp_path, emit_tsv=False)
    assert m["tables"]["data_sources"]["row_count"] == 0
    assert (tmp_path / "data_sources.parquet").exists()


def test_pg_tsv_renders_arrays_nulls_bools(tmp_path):
    import polars as pl
    from scripts.populator.core.writer import _write_pg_tsv
    df = pl.DataFrame({
        "id": ["u1"],
        "product": [["hydrogen-cyanide", "NRPS"]],
        "is_complete": [False],
        "core_start_pos": [None],
    })
    p = tmp_path / "x.tsv"
    _write_pg_tsv(df, p)
    fields = p.read_text().rstrip("\n").split("\t")
    assert fields[0] == "u1"
    assert fields[1] == '{"hydrogen-cyanide","NRPS"}'
    assert fields[2] == "f"
    assert fields[3] == r"\N"


def test_pg_tsv_escapes_special_chars(tmp_path):
    import polars as pl
    from scripts.populator.core.writer import _write_pg_tsv
    df = pl.DataFrame({"name": ["a\tb\\c"]})   # tab + backslash in a text field
    p = tmp_path / "x.tsv"
    _write_pg_tsv(df, p)
    line = p.read_text().rstrip("\n")
    assert line == "a\\tb\\\\c"   # tab -> \t, backslash -> \\


def test_write_tables_emit_tsv(tmp_path):
    from scripts.populator.core.writer import write_tables
    tables = {"data_sources": [{"id": "u1", "source_type": "third_party",
                               "name": "DS_x", "description": None,
                               "source_url": None, "user_upload_id": None}]}
    m = write_tables(tables, tmp_path, emit_tsv=True)
    assert (tmp_path / "data_sources.tsv").exists()
    assert m["tables"]["data_sources"]["tsv_path"] == "data_sources.tsv"
    assert "DS_x" in (tmp_path / "data_sources.tsv").read_text()


def test_pg_tsv_none_default_for_notnull_column(tmp_path):
    import polars as pl
    from scripts.populator.core.writer import _write_pg_tsv
    df = pl.DataFrame({"id": ["u1"], "metadata": [None]})
    p = tmp_path / "x.tsv"
    _write_pg_tsv(df, p, none_defaults={"metadata": "{}"})
    fields = p.read_text().rstrip("\n").split("\t")
    assert fields[1] == "{}"


def test_pg_tsv_dict_renders_json(tmp_path):
    import polars as pl
    from scripts.populator.core.writer import _write_pg_tsv
    df = pl.DataFrame({"metadata": [{"k": "v"}]})
    p = tmp_path / "x.tsv"
    _write_pg_tsv(df, p)
    assert p.read_text().rstrip("\n") == '{"k":"v"}'


def test_pg_tsv_empty_array(tmp_path):
    import polars as pl
    from scripts.populator.core.writer import _write_pg_tsv
    df = pl.DataFrame({"product": [[]]}, schema={"product": pl.List(pl.Utf8)})
    p = tmp_path / "x.tsv"
    _write_pg_tsv(df, p)
    assert p.read_text().rstrip("\n") == "{}"


def test_pg_tsv_literal_null_array_element(tmp_path):
    import polars as pl
    from scripts.populator.core.writer import _write_pg_tsv
    df = pl.DataFrame({"product": [["NULL"]]}, schema={"product": pl.List(pl.Utf8)})
    p = tmp_path / "x.tsv"
    _write_pg_tsv(df, p)
    assert p.read_text().rstrip("\n") == '{"NULL"}'     # quoted => literal string, not SQL NULL


def test_write_tables_emit_tsv_metadata_defaulted(tmp_path):
    from scripts.populator.core.writer import write_tables
    tables = {"samples": [{"id": "u1", "external_id": "x", "name": "n",
                           "accession": "a", "data_source_ids": ["d1"], "metadata": None}]}
    write_tables(tables, tmp_path, emit_tsv=True)
    last = (tmp_path / "samples.tsv").read_text().rstrip("\n").split("\t")[-1]
    assert last == "{}"     # metadata None -> {} (schema none_defaults), not \N


def test_write_tables_all_none_then_float_numeric_column(tmp_path):
    """A nullable numeric column None for the first >100 rows then a float must not
    crash polars' default infer_schema_length=100 (the SPIRE env-only run failure)."""
    from scripts.populator.core.writer import write_tables
    rows = []
    for i in range(110):
        rows.append({"id": f"u{i}", "external_id": f"x{i}", "name": f"n{i}",
                     "ph": None})
    rows.append({"id": "u110", "external_id": "x110", "name": "n110", "ph": 4.62})
    rows.append({"id": "u111", "external_id": "x111", "name": "n111", "ph": None})
    m = write_tables({"samples": rows}, tmp_path, emit_tsv=True)
    assert m["tables"]["samples"]["row_count"] == 112
    tsv = (tmp_path / "samples.tsv").read_text()
    assert "4.62" in tsv
    ph_idx = list(TABLES["samples"].columns).index("ph")
    lines = tsv.rstrip("\n").split("\n")
    assert lines[110].split("\t")[ph_idx] == "4.62"
    assert lines[0].split("\t")[ph_idx] == r"\N"
    assert lines[111].split("\t")[ph_idx] == r"\N"


def test_write_table_chunk_explicit_schema_globs_without_cast_error(tmp_path):
    """A column all-None in one chunk and typed in another must glob without a cast
    error; BGCS_SCHEMA keeps dtypes identical per part."""
    import polars as pl
    from scripts.populator.core.writer import write_table_chunk, BGCS_SCHEMA
    c0 = [{"id": "1", "filename": "f1", "contig": "c1", "start_pos": 0, "end_pos": 9,
           "core_start_pos": None, "core_end_pos": None,        # all-None in chunk 0
           "product": ["t"], "product_category": ["x"],
           "is_complete": True, "num_cds_features": 3}]
    c1 = [{"id": "2", "filename": "f2", "contig": "c2", "start_pos": 5, "end_pos": 20,
           "core_start_pos": 7, "core_end_pos": 15,             # typed in chunk 1
           "product": ["u"], "product_category": ["y"],
           "is_complete": False, "num_cds_features": 1}]
    e0 = write_table_chunk("bgcs", c0, tmp_path, 0, schema=BGCS_SCHEMA)
    e1 = write_table_chunk("bgcs", c1, tmp_path, 1, schema=BGCS_SCHEMA)
    assert e0["parquet_path"] == "bgcs_0000.parquet" and e1["parquet_path"] == "bgcs_0001.parquet"
    df = pl.read_parquet(str(tmp_path / "bgcs*.parquet"))
    assert df.height == 2
    assert df.schema["core_start_pos"] == pl.Int64
    assert df.schema["product"] == pl.List(pl.Utf8)
    assert set(df["filename"].to_list()) == {"f1", "f2"}


def test_write_table_chunk_empty_chunk_has_schema(tmp_path):
    import polars as pl
    from scripts.populator.core.writer import write_table_chunk, BGCS_SCHEMA
    e = write_table_chunk("bgcs", [], tmp_path, 0, schema=BGCS_SCHEMA)
    assert e["row_count"] == 0
    df = pl.read_parquet(str(tmp_path / "bgcs_0000.parquet"))
    assert df.height == 0 and df.schema["start_pos"] == pl.Int64
