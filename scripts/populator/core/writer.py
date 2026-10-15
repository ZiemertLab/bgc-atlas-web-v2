import hashlib
import json
from pathlib import Path
from typing import Dict, List, Union
import polars as pl
from ..schema import TABLES


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# Explicit schema so streamed bgcs_NNNN.parquet parts glob cleanly: a column that is
# all-None in one part would otherwise get polars Null dtype and cast-error on read.
BGCS_SCHEMA = {
    "id": pl.Utf8, "filename": pl.Utf8, "assembly": pl.Utf8, "analysis_id": pl.Utf8,
    "antismash_run_id": pl.Utf8, "contig": pl.Utf8,
    "start_pos": pl.Int64, "end_pos": pl.Int64,
    "core_start_pos": pl.Int64, "core_end_pos": pl.Int64,
    "product_category": pl.List(pl.Utf8), "product": pl.List(pl.Utf8),
    "anchor": pl.Utf8, "is_complete": pl.Boolean,
    "num_cds_features": pl.Int64,
}

# Streamed like bgcs, with an explicit schema for the same all-None-part hazard.
BGC_TAXONOMY_SCHEMA = {
    "bgc_id": pl.Utf8, "taxonomy_id": pl.Utf8, "rank": pl.Utf8,
    "support": pl.Float64, "method": pl.Utf8,
}


def write_table_chunk(table: str, rows: List[dict], out_dir: Union[str, Path],
                      chunk_index: int, *, schema=None, emit_tsv: bool = False) -> dict:
    """Write one chunk as ``<table>_{NNN:04d}.parquet`` (+ ``.tsv``) and return its
    manifest entry. Pass an explicit ``schema`` so all chunks share dtypes."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    cols = list(TABLES[table].columns)
    norm = [{c: r.get(c) for c in cols} for r in rows]
    if schema is not None:
        df = pl.DataFrame(norm, schema=schema)
    elif not norm:
        df = pl.DataFrame({c: [] for c in cols})
    else:
        # infer_schema_length=None: an all-None prefix would otherwise infer Null dtype.
        df = pl.DataFrame(norm, infer_schema_length=None).select(cols)
    base = f"{table}_{chunk_index:04d}"
    pq = out_dir / f"{base}.parquet"
    df.write_parquet(pq)
    entry = {"row_count": df.shape[0], "parquet_path": pq.name, "sha256": _sha256(pq)}
    if emit_tsv:
        tsv = out_dir / f"{base}.tsv"
        _write_pg_tsv(df, tsv, none_defaults=dict(TABLES[table].none_defaults))
        entry["tsv_path"] = tsv.name
    return entry


def write_tables(tables: Dict[str, List[dict]], out_dir: Union[str, Path],
                 emit_tsv: bool = False, version: str = "0.0.0") -> dict:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = {"version": version, "tables": {}}
    for name, rows in tables.items():
        cols = list(TABLES[name].columns)   # tuple -> list for polars
        norm = [{c: r.get(c) for c in cols} for r in rows]
        # A column all-None in one dataset is inferred as Null (DuckDB: INTEGER), which
        # breaks multi-source read_parquet globs where another source types it.
        if not norm:
            df = pl.DataFrame({c: [] for c in cols})
        else:
            # infer_schema_length=None: an all-None prefix would otherwise infer Null dtype.
            df = pl.DataFrame(norm, infer_schema_length=None).select(cols)
        pq = out_dir / f"{name}.parquet"
        df.write_parquet(pq)
        entry = {"row_count": df.shape[0], "parquet_path": pq.name,
                 "sha256": _sha256(pq)}
        if emit_tsv:
            tsv = out_dir / f"{name}.tsv"
            _write_pg_tsv(df, tsv, none_defaults=dict(TABLES[name].none_defaults))
            entry["tsv_path"] = tsv.name
        manifest["tables"][name] = entry
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
    return manifest


def _copy_escape(s: str) -> str:
    return (s.replace("\\", "\\\\")
             .replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r"))


def _array_literal(items) -> str:
    # Escape " and \ per Postgres array-literal syntax.
    elems = []
    for it in items:
        if it is None:
            elems.append("NULL")
        else:
            s = str(it).replace("\\", "\\\\").replace('"', '\\"')
            elems.append(f'"{s}"')
    return "{" + ",".join(elems) + "}"


def _render_pg_field(v, is_list: bool, none_default) -> str:
    if v is None:
        return _copy_escape(none_default) if none_default is not None else r"\N"
    if is_list:
        return _copy_escape(_array_literal(v))
    if isinstance(v, dict):                       # JSONB column with a value
        return _copy_escape(json.dumps(v, separators=(",", ":")))
    if isinstance(v, bool):
        return "t" if v else "f"
    return _copy_escape(str(v))


def _write_pg_tsv(df, path, none_defaults=None):
    none_defaults = none_defaults or {}
    cols = df.columns
    list_cols = {c for c, dt in df.schema.items() if isinstance(dt, pl.List)}
    with open(path, "w", newline="") as f:
        for row in df.iter_rows(named=True):
            fields = [_render_pg_field(row[c], c in list_cols, none_defaults.get(c)) for c in cols]
            f.write("\t".join(fields) + "\n")
