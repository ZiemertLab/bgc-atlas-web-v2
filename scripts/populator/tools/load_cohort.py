#!/usr/bin/env python3
"""Generate the guarded, append-only load (and its exact rollback) for one staged cohort.

A cohort is one populator emit dir (``populator-out/<source>``) of NEW samples, plus its
approved GOLD paths and, optionally, its orf_lca_v1 taxonomy rows (build_lca_taxonomy_rows.py).

Unlike load_mag_collections.py (every row disjoint), a cohort touches shared tables:

  data_sources  must already exist: asserted, never inserted -- except the ids given with
                --new-data-source (a cohort that is a new source, e.g. a custom dataset): those
                must NOT be live, are inserted, and rollback.sql removes them once nothing
                references them.
  biomes        ``ON CONFLICT (id) DO NOTHING``. A NEW biome whose ENVO id (or, without
                one, whose name) is live under another id is refused: it would be a
                duplicate term.
  studies       a fields-less row is a stub for a LIVE study the cohort attaches to
                (metalog ``study_overrides.existing``): asserted, not inserted. The rest
                are inserted and must not be live.
  taxonomies    ``uq_gtdb_lineage`` is unique on the lineage ALONE, so most lineages
                already exist under another source: ``ON CONFLICT (gtdb_lineage) DO
                NOTHING``, then bgc_taxonomy joins on the lineage.

Every other table is new rows only, asserted not live. The emit leaves three things to the
load: samples.gold_ecosystem_path/_metadata (the approved file), antismash_runs.
antismash_version/pipeline_version (given on the command line; read them off the archives'
GBK ##antiSMASH-Data## block), and bgc_taxonomy.

Every count the SQL checks comes from --expect, a JSON the operator writes from numbers
obtained independently of the emit (the batch's own validation, the plan). The emit's
manifest and pred.tsv must agree with it, so a truncated file cannot pass as complete.

load.sql is ONE transaction. It creates ``ld_<tag>_*`` staging tables, \\copy-s the TSVs into
them, checks the staged counts against the emit's manifest, runs the pre-gates, inserts in FK
order, records which shared rows it created in ``ld_<tag>_created``, runs the post-gates, and
commits. Any failure rolls back everything, staging tables included. After a commit the
staging tables stay: rollback.sql reads them, and a second run of load.sql stops on CREATE TABLE.

rollback.sql deletes exactly the staged rows. It refuses while derived data hangs off them
(GCF membership, BGC features, a family representative, BiG-SLiCE hits, GOLD reclass rows,
study links): that data came after the load and a cascade would silently take it too. Of the
shared rows it deletes only those this load created and nothing else uses; the rest are
spared and listed. A rollback after the post-load refresh also means redoing the matviews,
the studies precompute and the search indexes. drop_staging.sql removes the ld_<tag>_* tables
once the load is final (and before a reload after a rollback).

The generator never opens a database connection. Usage:

    python -m scripts.populator.tools.load_cohort --emit <populator-out/metalog> --tag metalog173 \\
        --out <dir> --expect <expect.json> --gold <gold_paths_approved.tsv> --gold-source metalog_added_review \\
        --mapped-at 2026-10-12 --antismash-version 8.0.4 --pipeline-version 'metaSMASH 1.0.3' \\
        [--taxonomy <dir with pred.tsv, lineages.tsv>]
    cd <out> && psql -d bgc_atlas_v2 -f load.sql
"""
from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path

from scripts.populator.core.gold_normalize import normalize_gold_ecosystem_path
from scripts.populator.schema import TABLES, load_order

# The tables a cohort may carry. An emitted table outside this set is refused, not skipped.
COHORT_TABLES = {
    "data_sources", "biomes", "studies", "samples", "assemblies", "analyses", "antismash_runs",
    "bgcs", "sample_assemblies", "sample_analyses", "assembly_analyses", "study_samples",
    "sample_biomes", "sample_measurements",
}
# New-rows-only entity tables: none of their ids may be live.
DISJOINT = ["samples", "assemblies", "analyses", "antismash_runs", "bgcs", "sample_measurements"]
# Junctions: inserted as-is, counted after.
JUNCTIONS = {
    "sample_assemblies": ("sample_id", "assembly_id"),
    "sample_analyses": ("sample_id", "analysis_id"),
    "assembly_analyses": ("assembly_id", "analysis_id"),
    "study_samples": ("study_id", "sample_id"),
    "sample_biomes": ("sample_id", "biome_id"),
}
# studies columns that make a row more than a stub (id, data_source_ids, biome_ids and an
# empty metadata are what the adapter writes for an `existing` override).
STUDY_FIELDS = ("external_id", "accession", "study_name", "title", "abstract", "study_type",
                "bioproject", "secondary_accession", "center_name")
TAG_RE = re.compile(r"^[a-z][a-z0-9_]{0,30}$")
NULL = r"\N"
RANKS = ("domain", "phylum", "class", "order", "family", "genus", "species")


class CohortError(ValueError):
    pass


def count_lines(p: Path) -> int:
    with open(p) as fh:
        return sum(1 for _ in fh)


def tsv_files(d: Path, table: str) -> list[Path]:
    single = d / f"{table}.tsv"
    if single.exists():
        return [single]
    return sorted(d.glob(f"{table}_[0-9]*.tsv"))


def read_rows(d: Path, table: str) -> list[dict]:
    cols = TABLES[table].columns
    rows = []
    for f in tsv_files(d, table):
        with open(f, newline="") as fh:
            for line in fh:
                vals = line.rstrip("\n").split("\t")
                if len(vals) != len(cols):
                    raise CohortError(f"{f.name}: {len(vals)} fields, {table} has {len(cols)} columns")
                rows.append(dict(zip(cols, vals)))
    return rows


def is_stub(study: dict) -> bool:
    return all(study.get(c, NULL) in (NULL, "") for c in STUDY_FIELDS) and study.get("metadata") in (NULL, "{}", "")


def sql_str(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def inspect(emit: Path) -> dict:
    """Tables present, their row counts (checked against manifest.json) and the stub studies."""
    manifest = json.loads((emit / "manifest.json").read_text())["tables"]
    present = {}
    for t in manifest:
        if t not in TABLES:
            raise CohortError(f"manifest lists {t!r}, which the populator schema does not define")
        if not tsv_files(emit, t):
            raise CohortError(f"manifest lists {t!r} but no {t}.tsv is in {emit}")
        if t not in COHORT_TABLES:
            raise CohortError(f"the emit carries {t!r}, which a cohort load does not handle")
        n = sum(count_lines(f) for f in tsv_files(emit, t))
        if n != manifest[t]["row_count"]:
            raise CohortError(f"{t}: {n} TSV rows, manifest says {manifest[t]['row_count']}")
        present[t] = n
    for t in ("data_sources", "samples", "antismash_runs", "bgcs"):
        if t not in present:
            raise CohortError(f"the emit has no {t}")
    studies = read_rows(emit, "studies") if "studies" in present else []
    stubs = sorted(s["id"] for s in studies if is_stub(s))
    return {"counts": present, "stubs": stubs, "new_studies": len(studies) - len(stubs)}


def build_gold(emit: Path, gold_tsv: Path, key_col: str, path_col: str) -> list[tuple[str, str]]:
    """(sample_id, normalized path) for every staged sample; the file must cover exactly them."""
    by_name = {r["name"]: r["id"] for r in read_rows(emit, "samples")}
    with open(gold_tsv, newline="") as fh:
        rows = list(csv.DictReader(fh, delimiter="\t"))
    if rows and (key_col not in rows[0] or path_col not in rows[0]):
        raise CohortError(f"{gold_tsv.name}: needs columns {key_col!r} and {path_col!r}")
    seen, out = set(), []
    for r in rows:
        name, raw = r[key_col], r[path_col]
        if name in seen:
            raise CohortError(f"{gold_tsv.name}: {name} listed twice")
        seen.add(name)
        if name not in by_name:
            raise CohortError(f"{gold_tsv.name}: {name} is not a staged sample")
        path = normalize_gold_ecosystem_path(raw)
        if not path:
            raise CohortError(f"{gold_tsv.name}: {name}: {raw!r} does not normalize to a GOLD path")
        if any(ch in path for ch in "\t\n\\"):
            raise CohortError(f"{gold_tsv.name}: {name}: {path!r} has a tab, newline or backslash")
        out.append((by_name[name], path))
    missing = sorted(set(by_name) - seen)
    if missing:
        raise CohortError(f"{gold_tsv.name}: no path for {len(missing)} staged samples, e.g. {missing[:3]}")
    return sorted(out)


def check_expect(expect: dict, info: dict, n_pred: int | None) -> None:
    """The emit must match the independently written expectations, key for key."""
    for key in ("samples", "bgcs"):
        if key not in expect:
            raise CohortError(f"--expect must give {key!r}")
    actual = dict(info["counts"])
    actual.update(stubs=len(info["stubs"]), new_studies=info["new_studies"],
                  new_data_sources=info.get("new_data_sources", 0))
    if n_pred is not None:
        actual["bgc_taxonomy"] = n_pred
    for key, want in expect.items():
        if key.startswith("_"):              # a note, e.g. where each number came from
            continue
        if key not in actual:
            raise CohortError(f"--expect gives {key!r}, which this cohort does not have")
        if actual[key] != want:
            raise CohortError(f"{key}: the emit has {actual[key]:,}, --expect says {want:,}")


def generate(a) -> dict:
    emit = Path(a.emit).resolve()
    out = Path(a.out).resolve()
    if not TAG_RE.match(a.tag):
        raise CohortError(f"--tag {a.tag!r}: lower-case letters, digits, underscores; starts with a letter")
    info = inspect(emit)
    counts, stubs = info["counts"], info["stubs"]
    new_ds = sorted(set(a.new_data_source or []))
    staged_ds = {r["id"] for r in read_rows(emit, "data_sources")}
    if set(new_ds) - staged_ds:
        raise CohortError(f"--new-data-source {sorted(set(new_ds) - staged_ds)}: not a staged data source")
    info["new_data_sources"] = len(new_ds)
    gold = build_gold(emit, Path(a.gold), a.gold_key, a.gold_col)
    tax = None
    if a.taxonomy:
        td = Path(a.taxonomy).resolve()
        tax = {"pred": td / "pred.tsv", "lineages": td / "lineages.tsv"}
        for p in tax.values():
            if not p.exists():
                raise CohortError(f"{p} missing")
        bgc_ids = {r["id"] for r in read_rows(emit, "bgcs")}
        with open(tax["pred"]) as fh:
            pred_ids = [line.split("\t", 1)[0] for line in fh]
        if len(pred_ids) != len(set(pred_ids)) or not set(pred_ids) <= bgc_ids:
            raise CohortError("pred.tsv: duplicate ids, or ids that are not staged bgcs")
        tax["n_pred"] = len(pred_ids)
        tax["n_lineages"] = count_lines(tax["lineages"])
    check_expect(json.loads(Path(a.expect).read_text()), info, tax["n_pred"] if tax else None)
    out.mkdir(parents=True, exist_ok=True)
    gold_file = out / "gold.tsv"
    gold_file.write_text("".join(f"{sid}\t{path}\n" for sid, path in gold))

    order = [t for t in load_order() if t in counts]
    p = f"ld_{a.tag}_"
    gold_meta = json.dumps({"source": a.gold_source, "confidence": a.gold_confidence, "mapped_at": a.mapped_at})
    L: list[str] = []
    w = L.append
    w(f"-- load.sql for cohort {a.tag}: generated by scripts/populator/tools/load_cohort.py. Target: bgc_atlas_v2.")
    w(f"-- emit: {emit}")
    w("-- rows: " + ", ".join(f"{t} {counts[t]:,}" for t in order)
      + (f", bgc_taxonomy {tax['n_pred']:,}" if tax else ""))
    w(f"-- stub studies (live, attached to, not inserted): {', '.join(stubs) or 'none'}")
    w("-- Run: psql -d bgc_atlas_v2 -f load.sql")
    w("-- Undo after a commit: rollback.sql. A failure before COMMIT leaves nothing behind.")
    w(r"\set ON_ERROR_STOP on")
    w("SET statement_timeout = 0;")
    w("SET lock_timeout = '60s';")
    w(r"\timing on")
    w("BEGIN;")
    w("")
    w("-- 1. staging")
    for t in order:
        w(f"CREATE TABLE {p}{t} (LIKE {t} INCLUDING DEFAULTS);")
        cols = ", ".join(TABLES[t].columns)
        for f in tsv_files(emit, t):
            w(rf"\copy {p}{t} ({cols}) FROM {sql_str(str(f))} WITH (FORMAT text, NULL '\N')")
    w(f"CREATE TABLE {p}gold (sample_id uuid PRIMARY KEY, gold_ecosystem_path text NOT NULL);")
    w(rf"\copy {p}gold FROM {sql_str(str(gold_file))} WITH (FORMAT text)")
    if tax:
        w(f"CREATE TABLE {p}tax_lineages (gtdb_lineage text PRIMARY KEY, domain text, phylum text, class text, "
          "order_name text, family text, genus text, species text, source text, is_partial boolean, rank_depth integer);")
        w(f"CREATE TABLE {p}tax_pred (bgc_id uuid PRIMARY KEY, gtdb_lineage text NOT NULL, rank text NOT NULL, support real);")
        w(rf"\copy {p}tax_lineages FROM {sql_str(str(tax['lineages']))} WITH (FORMAT text)")
        w(rf"\copy {p}tax_pred FROM {sql_str(str(tax['pred']))} WITH (FORMAT text)")
    w(f"CREATE TABLE {p}created (kind text NOT NULL, id uuid NOT NULL, PRIMARY KEY (kind, id));")
    w(f"CREATE TABLE {p}stubs (id uuid PRIMARY KEY);")
    w(f"CREATE TABLE {p}new_data_sources (id uuid PRIMARY KEY);")
    if new_ds:
        w(f"INSERT INTO {p}new_data_sources VALUES " + ", ".join(f"('{d}')" for d in new_ds) + ";")
    if stubs:
        w(f"INSERT INTO {p}stubs VALUES " + ", ".join(f"('{s}')" for s in stubs) + ";")
    for t in order:
        w(f"ANALYZE {p}{t};")
    w(f"ANALYZE {p}gold;")
    if tax:
        w(f"ANALYZE {p}tax_lineages; ANALYZE {p}tax_pred;")
    w("")

    w("-- 2. pre-gates")
    w("DO $$")
    w("DECLARE n bigint;")
    w("BEGIN")

    def gate(sql: str, expect: int | str, msg: str):
        w(f"    SELECT ({sql}) INTO n;")
        w(f"    IF n <> {expect} THEN RAISE EXCEPTION '{msg}: %, expected {expect}', n; END IF;")

    for t in order:
        gate(f"SELECT count(*) FROM {p}{t}", counts[t], f"staged {t}")
    gate(f"SELECT count(*) FROM {p}gold", counts["samples"], "gold paths")
    gate(f"SELECT count(*) FROM {p}gold g LEFT JOIN {p}samples s ON s.id = g.sample_id WHERE s.id IS NULL", 0,
         "gold rows for unstaged samples")
    # an adapter may emit a GOLD path itself (customs_metadata.EMIT_SOURCES); it must be the approved one
    gate(f"SELECT count(*) FROM {p}samples s JOIN {p}gold g ON g.sample_id = s.id "
         f"WHERE s.gold_ecosystem_path IS NOT NULL AND s.gold_ecosystem_path <> g.gold_ecosystem_path", 0,
         "emitted GOLD paths that differ from --gold")
    gate(f"SELECT count(*) FROM {p}data_sources d LEFT JOIN data_sources x ON x.id = d.id WHERE x.id IS NULL "
         f"AND d.id NOT IN (SELECT id FROM {p}new_data_sources)", 0, "data_sources not live")
    gate(f"SELECT count(*) FROM {p}new_data_sources d JOIN data_sources x ON x.id = d.id", 0,
         "new data_sources already live")
    w("    -- primary-key probes; a hash join here would read the whole of bgcs")
    w("    SET LOCAL enable_hashjoin = off; SET LOCAL enable_mergejoin = off;")
    for t in DISJOINT:
        if t in counts:
            gate(f"SELECT count(*) FROM {p}{t} s JOIN {t} x ON x.id = s.id", 0, f"{t} ids already live")
    if "studies" in counts:
        gate(f"SELECT count(*) FROM {p}stubs s JOIN {p}studies st ON st.id = s.id", len(stubs), "stub ids staged")
        gate(f"SELECT count(*) FROM {p}stubs s JOIN studies x ON x.id = s.id", len(stubs), "stub studies live")
        gate(f"SELECT count(*) FROM {p}studies s JOIN studies x ON x.id = s.id WHERE s.id NOT IN (SELECT id FROM {p}stubs)",
             0, "new studies already live")
        gate(f"SELECT count(*) FROM {p}studies s JOIN studies x ON x.accession = s.accession "
             f"WHERE s.id NOT IN (SELECT id FROM {p}stubs)", 0, "new studies whose accession is live")
    if "biomes" in counts:
        gate(f"SELECT count(*) FROM {p}biomes b WHERE NOT EXISTS (SELECT 1 FROM biomes x WHERE x.id = b.id) "
             f"AND EXISTS (SELECT 1 FROM biomes x WHERE (b.metadata->>'envo_id' IS NOT NULL AND x.metadata->>'envo_id' = b.metadata->>'envo_id') "
             f"OR (b.metadata->>'envo_id' IS NULL AND x.metadata->>'envo_id' IS NULL AND lower(x.name) = lower(b.name)))",
             0, "new biomes duplicating a live term")
    if tax:
        gate(f"SELECT count(*) FROM {p}tax_pred", tax["n_pred"], "staged predictions")
        gate(f"SELECT count(*) FROM {p}tax_lineages", tax["n_lineages"], "staged lineages")
        gate(f"SELECT count(*) FROM {p}tax_pred t LEFT JOIN {p}bgcs b ON b.id = t.bgc_id WHERE b.id IS NULL", 0,
             "predictions for unstaged bgcs")
        gate(f"SELECT count(*) FROM {p}tax_pred t LEFT JOIN {p}tax_lineages l USING (gtdb_lineage) WHERE l.gtdb_lineage IS NULL",
             0, "predictions without a lineage row")
        gate(f"SELECT count(*) FROM {p}tax_pred t JOIN bgc_taxonomy x ON x.bgc_id = t.bgc_id", 0,
             "bgc_taxonomy rows already live")
    w("    RESET enable_hashjoin; RESET enable_mergejoin;")
    w("END $$;")
    w("")

    w("-- 3. inserts, in FK order")

    def cols_of(t):
        return ", ".join(TABLES[t].columns)

    for t in order:
        c = cols_of(t)
        if t == "data_sources":
            if new_ds:
                w(f"WITH ins AS (INSERT INTO data_sources ({c}) SELECT {c} FROM {p}data_sources "
                  f"WHERE id IN (SELECT id FROM {p}new_data_sources) RETURNING id)")
                w(f"INSERT INTO {p}created SELECT 'data_sources', id FROM ins;")
            continue
        if t == "biomes":
            w(f"WITH ins AS (INSERT INTO biomes ({c}) SELECT {c} FROM {p}biomes ON CONFLICT (id) DO NOTHING RETURNING id)")
            w(f"INSERT INTO {p}created SELECT 'biomes', id FROM ins;")
        elif t == "studies":
            w(f"WITH ins AS (INSERT INTO studies ({c}) SELECT {c} FROM {p}studies "
              f"WHERE id NOT IN (SELECT id FROM {p}stubs) RETURNING id)")
            w(f"INSERT INTO {p}created SELECT 'studies', id FROM ins;")
        elif t == "samples":
            sel = ", ".join("g.gold_ecosystem_path" if col == "gold_ecosystem_path" else f"s.{col}"
                            for col in TABLES[t].columns)
            w(f"INSERT INTO samples ({c}, gold_ecosystem_metadata) SELECT {sel}, {sql_str(gold_meta)}::jsonb "
              f"FROM {p}samples s JOIN {p}gold g ON g.sample_id = s.id;")
        elif t == "antismash_runs":
            sel = ", ".join({"antismash_version": sql_str(a.antismash_version),
                             "pipeline_version": sql_str(a.pipeline_version)}.get(col, col) for col in TABLES[t].columns)
            w(f"INSERT INTO antismash_runs ({c}) SELECT {sel} FROM {p}antismash_runs;")
        elif t == "bgcs":
            w(f"INSERT INTO bgcs ({c}) SELECT {c} FROM {p}bgcs ORDER BY id;")
        else:
            w(f"INSERT INTO {t} ({c}) SELECT {c} FROM {p}{t};")
    if tax:
        w("WITH ins AS (INSERT INTO taxonomies (gtdb_lineage, domain, phylum, class, order_name, family, genus, species, "
          "source, is_partial, rank_depth)")
        w("    SELECT gtdb_lineage, domain, phylum, class, order_name, family, genus, species, source, is_partial, rank_depth")
        w(f"    FROM {p}tax_lineages ON CONFLICT (gtdb_lineage) DO NOTHING RETURNING id)")
        w(f"INSERT INTO {p}created SELECT 'taxonomies', id FROM ins;")
        w("INSERT INTO bgc_taxonomy (bgc_id, taxonomy_id, rank, support, method)")
        w(f"SELECT t.bgc_id, x.id, t.rank, t.support, {sql_str(a.taxonomy_method)} "
          f"FROM {p}tax_pred t JOIN taxonomies x ON x.gtdb_lineage = t.gtdb_lineage;")
    w("")

    w("-- 4. post-gates: every staged row is live, with the fields this load sets")
    w("DO $$")
    w("DECLARE n bigint;")
    w("BEGIN")
    w("    SET LOCAL enable_hashjoin = off; SET LOCAL enable_mergejoin = off;")
    for t in order:
        if t in ("data_sources", "biomes", "studies"):
            gate(f"SELECT count(*) FROM {p}{t} s JOIN {t} x ON x.id = s.id", counts[t], f"live {t}")
        elif t in JUNCTIONS:
            k1, k2 = JUNCTIONS[t]
            gate(f"SELECT count(*) FROM {p}{t} s JOIN {t} x ON x.{k1} = s.{k1} AND x.{k2} = s.{k2}", counts[t], f"live {t}")
        else:
            gate(f"SELECT count(*) FROM {p}{t} s JOIN {t} x ON x.id = s.id", counts[t], f"live {t}")
    gate(f"SELECT count(*) FROM {p}samples s JOIN samples x ON x.id = s.id "
         f"WHERE x.gold_ecosystem_path IS NOT NULL AND x.gold_ecosystem_metadata IS NOT NULL", counts["samples"],
         "samples with a GOLD path")
    gate(f"SELECT count(*) FROM {p}antismash_runs s JOIN antismash_runs x ON x.id = s.id "
         f"WHERE x.antismash_version = {sql_str(a.antismash_version)} AND x.pipeline_version = {sql_str(a.pipeline_version)}",
         counts["antismash_runs"], "runs with their versions")
    gate(f"SELECT count(*) FROM {p}antismash_runs r WHERE r.num_bgcs <> "
         f"(SELECT count(*) FROM {p}bgcs b WHERE b.antismash_run_id = r.id)", 0, "runs whose num_bgcs differs from their bgcs")
    if "study_samples" in counts:
        gate(f"SELECT count(*) FROM {p}samples s WHERE NOT EXISTS (SELECT 1 FROM study_samples x WHERE x.sample_id = s.id)",
             0, "samples without a study")
    if tax:
        gate(f"SELECT count(*) FROM bgc_taxonomy b JOIN {p}tax_pred t ON t.bgc_id = b.bgc_id", tax["n_pred"], "live bgc_taxonomy")
        gate(f"SELECT count(*) FROM bgc_taxonomy b JOIN {p}tax_pred t ON t.bgc_id = b.bgc_id "
             f"JOIN taxonomies x ON x.id = b.taxonomy_id "
             f"WHERE b.rank IS DISTINCT FROM (ARRAY{list(RANKS)})[x.rank_depth] OR x.gtdb_lineage <> t.gtdb_lineage", 0,
             "bgc_taxonomy rows whose rank or lineage is off")
    w("END $$;")
    w(f"SELECT kind, count(*) AS created FROM {p}created GROUP BY 1 ORDER BY 1;")
    w("COMMIT;")
    w(r"\echo 'load committed. The ANALYZE statements below are housekeeping; a failure among them is not a failed load.'")
    # bgcs and bgc_taxonomy are left to autovacuum: an ANALYZE samples ~30k pages of a 16M-row table on CephFS
    for t in [t for t in order if t not in ("data_sources", "bgcs")]:
        w(f"ANALYZE {t};")
    (out / "load.sql").write_text("\n".join(L) + "\n")

    # rollback: refuse while later-derived data hangs off the cohort; then reverse FK order; shared
    # rows only when this load created them and nothing else uses them (the rest are listed, kept)
    R: list[str] = []
    r = R.append
    r(f"-- rollback.sql for cohort {a.tag}: deletes exactly what load.sql inserted. Reads the {p}* staging tables.")
    r("-- After the post-load refresh, a rollback also means redoing the matviews, the studies precompute and the")
    r("-- search indexes. sequence_search_results (no FK) may keep rows naming deleted bgcs.")
    r(r"\set ON_ERROR_STOP on")
    r("SET statement_timeout = 0;")
    r("SET lock_timeout = '60s';")
    r(r"\timing on")
    r("BEGIN;")
    r("SET LOCAL enable_hashjoin = off; SET LOCAL enable_mergejoin = off;")
    r("-- derived data attached after the load: an ON DELETE CASCADE / SET NULL would take it silently")
    r("DO $$")
    r("DECLARE n bigint;")
    r("BEGIN")
    derived = [("bgc_gcf", "bgc_id", "bgcs"), ("bgc_features", "bgc_id", "bgcs"),
               ("gcfs", "representative_bgc_id", "bgcs"), ("bigslice_search_results", "bgc_id", "bgcs"),
               ("bgc_gbk_offsets", "bgc_id", "bgcs"), ("gold_path_reclass", "sample_id", "samples"),
               ("gold_path_reclass_run1", "sample_id", "samples"), ("sample_runs", "sample_id", "samples")]
    for t, col, parent in derived:
        if parent in counts:
            r(f"    SELECT count(*) INTO n FROM {p}{parent} s JOIN {t} x ON x.{col} = s.id;")
            r(f"    IF n <> 0 THEN RAISE EXCEPTION '{t}: % rows reference this cohort''s {parent}; "
              f"remove them deliberately first', n; END IF;")
    # rows a later step attached to this cohort's samples / bgcs in tables the load itself did not fill
    # (e.g. study_samples from backfill_custom_studies.py): ON DELETE CASCADE would take them silently
    attached = [("study_samples", "sample_id", "samples"), ("sample_biomes", "sample_id", "samples"),
                ("sample_measurements", "sample_id", "samples")]
    if not tax:
        attached.append(("bgc_taxonomy", "bgc_id", "bgcs"))
    for t, col, parent in attached:
        if parent in counts and t not in counts:
            r(f"    SELECT count(*) INTO n FROM {p}{parent} s JOIN {t} x ON x.{col} = s.id;")
            r(f"    IF n <> 0 THEN RAISE EXCEPTION '{t}: % rows attached to this cohort''s {parent} after the load; "
              f"remove them deliberately first', n; END IF;")
    if "studies" in counts:
        for t in ("study_biomes", "run_studies"):
            r(f"    SELECT count(*) INTO n FROM {p}created c JOIN {t} x ON x.study_id = c.id WHERE c.kind = 'studies';")
            r(f"    IF n <> 0 THEN RAISE EXCEPTION '{t}: % rows reference studies this load created; "
              f"remove them deliberately first', n; END IF;")
    r("END $$;")
    if tax:
        r(f"DELETE FROM bgc_taxonomy b USING {p}tax_pred t WHERE b.bgc_id = t.bgc_id;")
    for t in reversed(order):
        if t in ("data_sources", "biomes", "studies"):
            continue
        if t in JUNCTIONS:
            k1, k2 = JUNCTIONS[t]
            r(f"DELETE FROM {t} x USING {p}{t} s WHERE x.{k1} = s.{k1} AND x.{k2} = s.{k2};")
        else:
            r(f"DELETE FROM {t} x USING {p}{t} s WHERE x.id = s.id;")
    if tax:
        r(f"DELETE FROM taxonomies x USING {p}created c WHERE c.kind = 'taxonomies' AND x.id = c.id "
          f"AND NOT EXISTS (SELECT 1 FROM bgc_taxonomy b WHERE b.taxonomy_id = x.id) "
          f"AND NOT EXISTS (SELECT 1 FROM assembly_taxonomy y WHERE y.taxonomy_id = x.id);")
    if "studies" in counts:
        r(f"DELETE FROM studies x USING {p}created c WHERE c.kind = 'studies' AND x.id = c.id "
          f"AND NOT EXISTS (SELECT 1 FROM study_samples s WHERE s.study_id = x.id);")
    r("DO $$")
    r("DECLARE n bigint;")
    r("BEGIN")
    if "biomes" in counts:
        r("    -- leaves first: a created parent goes once its created children have")
        r("    LOOP")
        r(f"        DELETE FROM biomes x USING {p}created c WHERE c.kind = 'biomes' AND x.id = c.id")
        r("           AND NOT EXISTS (SELECT 1 FROM sample_biomes s WHERE s.biome_id = x.id)")
        r("           AND NOT EXISTS (SELECT 1 FROM study_biomes s WHERE s.biome_id = x.id)")
        r("           AND NOT EXISTS (SELECT 1 FROM biomes y WHERE y.parent_id = x.id);")
        r("        GET DIAGNOSTICS n = ROW_COUNT;")
        r("        EXIT WHEN n = 0;")
        r("    END LOOP;")
    if new_ds:
        r("    -- a data source this load created goes once no row names it any more")
        r(f"    DELETE FROM data_sources x USING {p}created c WHERE c.kind = 'data_sources' AND x.id = c.id")
        for t in ("samples", "assemblies", "analyses", "studies"):
            r(f"       AND NOT EXISTS (SELECT 1 FROM {t} y WHERE y.data_source_ids @> ARRAY[x.id])"
              + (";" if t == "studies" else ""))
    for t in DISJOINT:
        if t in counts:
            r(f"    SELECT count(*) INTO n FROM {p}{t} s JOIN {t} x ON x.id = s.id;")
            r(f"    IF n <> 0 THEN RAISE EXCEPTION '{t}: % rows left', n; END IF;")
    for t, (k1, k2) in JUNCTIONS.items():
        if t in counts:
            r(f"    SELECT count(*) INTO n FROM {p}{t} s JOIN {t} x ON x.{k1} = s.{k1} AND x.{k2} = s.{k2};")
            r(f"    IF n <> 0 THEN RAISE EXCEPTION '{t}: % rows left', n; END IF;")
    if tax:
        r(f"    SELECT count(*) INTO n FROM {p}tax_pred t JOIN bgc_taxonomy x ON x.bgc_id = t.bgc_id;")
        r("    IF n <> 0 THEN RAISE EXCEPTION 'bgc_taxonomy: % rows left', n; END IF;")
    r("    -- shared rows this load created that something else now uses: kept, and listed")
    for kind in ("studies", "biomes", "taxonomies", "data_sources"):
        r(f"    SELECT count(*) INTO n FROM {p}created c JOIN {kind} x ON x.id = c.id WHERE c.kind = '{kind}';")
        r(f"    IF n <> 0 THEN RAISE NOTICE '{kind}: kept % rows this load created (used elsewhere; ids in {p}created)', n; END IF;")
    r("END $$;")
    r("COMMIT;")
    (out / "rollback.sql").write_text("\n".join(R) + "\n")

    staging = [f"{p}{t}" for t in order] + [f"{p}gold", f"{p}created", f"{p}stubs", f"{p}new_data_sources"] \
        + ([f"{p}tax_lineages", f"{p}tax_pred"] if tax else [])
    (out / "drop_staging.sql").write_text(
        f"-- drop the {p}* staging tables once the load is final (rollback.sql needs them).\n"
        f"DROP TABLE {', '.join(staging)};\n")
    report = {"tag": a.tag, "emit": str(emit), "counts": counts, "stubs": stubs, "new_studies": info["new_studies"],
              "new_data_sources": new_ds,
              "gold_paths": len(gold), "bgc_taxonomy": tax["n_pred"] if tax else 0,
              "lineages": tax["n_lineages"] if tax else 0}
    (out / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--emit", required=True, help="populator-out/<source> dir of the cohort")
    ap.add_argument("--tag", required=True, help="names the ld_<tag>_* staging tables")
    ap.add_argument("--out", required=True)
    ap.add_argument("--expect", required=True,
                    help="JSON of expected counts, written independently of the emit: table -> rows, plus "
                         "stubs / new_studies / bgc_taxonomy; samples and bgcs are required")
    ap.add_argument("--gold", required=True, help="TSV with a header: sample name + approved GOLD path")
    ap.add_argument("--gold-key", default="biosample", help="column holding samples.name")
    ap.add_argument("--gold-col", default="gold_ecosystem_path")
    ap.add_argument("--gold-source", required=True, help="gold_ecosystem_metadata.source")
    ap.add_argument("--gold-confidence", default="high", choices=["high", "medium-high", "medium", "low"])
    ap.add_argument("--mapped-at", required=True, help="gold_ecosystem_metadata.mapped_at (YYYY-MM-DD)")
    ap.add_argument("--antismash-version", required=True, help="antismash_runs.antismash_version, e.g. 8.0.4")
    ap.add_argument("--pipeline-version", required=True, help="antismash_runs.pipeline_version, e.g. 'metaSMASH 1.0.3'")
    ap.add_argument("--taxonomy", help="dir with pred.tsv + lineages.tsv from build_lca_taxonomy_rows.py")
    ap.add_argument("--taxonomy-method", default="orf_lca_v1")
    ap.add_argument("--new-data-source", action="append", metavar="ID",
                    help="a staged data_sources id this cohort introduces (repeatable); inserted, must not be live")
    a = ap.parse_args(argv)
    try:
        rep = generate(a)
    except CohortError as e:
        ap.exit(2, f"load_cohort: {e}\n")
    print(json.dumps(rep, indent=2))
    print(f"wrote {Path(a.out) / 'load.sql'}, rollback.sql, drop_staging.sql, gold.tsv")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
