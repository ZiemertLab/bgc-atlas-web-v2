import argparse
import json
import re

import pytest

from scripts.populator.schema import TABLES
from scripts.populator.tools.load_cohort import CohortError, generate, is_stub

N = r"\N"
DS = "11111111-1111-5111-8111-111111111111"
STUB = "22222222-2222-5222-8222-222222222222"
NEW_STUDY = "33333333-3333-5333-8333-333333333333"
BIOME = "44444444-4444-5444-8444-444444444444"
S1, S2 = "55555555-5555-5555-8555-555555555551", "55555555-5555-5555-8555-555555555552"
ASM, ANA, RUN = "66666666-6666-5666-8666-666666666661", "66666666-6666-5666-8666-666666666662", "66666666-6666-5666-8666-666666666663"
B1, B2 = "77777777-7777-5777-8777-777777777771", "77777777-7777-5777-8777-777777777772"


def _row(table, **vals):
    cols = TABLES[table].columns
    unknown = set(vals) - set(cols)
    assert not unknown, unknown
    return "\t".join(str(vals.get(c, N)) for c in cols)


def _emit(tmp_path, extra=None, drop=()):
    d = tmp_path / "emit"
    d.mkdir()
    tables = {
        "data_sources": [_row("data_sources", id=DS, source_type="metalog", name="metalog")],
        "studies": [_row("studies", id=STUB, data_source_ids="{%s}" % DS, metadata="{}"),
                    _row("studies", id=NEW_STUDY, study_name="Seitz_2016", data_source_ids="{%s}" % DS,
                         metadata='{"doi": "x"}')],
        "biomes": [_row("biomes", id=BIOME, name="estuary", level=1, metadata="{}")],
        "samples": [_row("samples", id=S1, external_id="metalog|A", name="SAMN1", metadata="{}"),
                    _row("samples", id=S2, external_id="metalog|B", name="SAMN2", metadata="{}")],
        "assemblies": [_row("assemblies", id=ASM, name="a", metadata="{}")],
        "analyses": [_row("analyses", id=ANA, name="a", metadata="{}")],
        "antismash_runs": [_row("antismash_runs", id=RUN, name="r", file_path="/x/r.tar.gz", num_bgcs=2,
                                status="completed")],
        "bgcs": [_row("bgcs", id=B1, filename="f1", antismash_run_id=RUN),
                 _row("bgcs", id=B2, filename="f2", antismash_run_id=RUN)],
        "study_samples": [_row("study_samples", study_id=STUB, sample_id=S1),
                          _row("study_samples", study_id=NEW_STUDY, sample_id=S2)],
        "sample_biomes": [_row("sample_biomes", sample_id=S1, biome_id=BIOME)],
    }
    tables.update(extra or {})
    manifest = {"tables": {}}
    for t, rows in tables.items():
        if t in drop:
            continue
        name = "bgcs_0000.tsv" if t == "bgcs" else f"{t}.tsv"
        (d / name).write_text("".join(r + "\n" for r in rows))
        manifest["tables"][t] = {"row_count": len(rows)}
    (d / "manifest.json").write_text(json.dumps(manifest))
    return d


def _gold(tmp_path, rows):
    p = tmp_path / "gold.tsv"
    p.write_text("biosample\tgold_ecosystem_path\n" + "".join(f"{a}\t{b}\n" for a, b in rows))
    return p


def _tax(tmp_path, pred_ids=(B1,)):
    d = tmp_path / "tax"
    d.mkdir()
    lin = "d__Bacteria;p__Pseudomonadota"
    (d / "lineages.tsv").write_text(f"{lin}\td__Bacteria\tp__Pseudomonadota\t" + "\t".join([N] * 5)
                                    + "\torf_lca_v1\tt\t2\n")
    (d / "pred.tsv").write_text("".join(f"{i}\t{lin}\tphylum\t0.9000\n" for i in pred_ids))
    return d


def _expect(tmp_path, **over):
    e = {"samples": 2, "bgcs": 2, "studies": 2, "stubs": 1, "new_studies": 1}
    e.update(over)
    p = tmp_path / f"expect_{len(list(tmp_path.glob('expect_*')))}.json"
    p.write_text(json.dumps(e))
    return p


def _args(tmp_path, emit, gold, expect=None, **kw):
    expect = expect or _expect(tmp_path, **({"bgc_taxonomy": 1} if kw.get("taxonomy") else {}))
    a = dict(emit=str(emit), tag="t1", out=str(tmp_path / "out"), expect=str(expect), gold=str(gold),
             gold_key="biosample",
             gold_col="gold_ecosystem_path", gold_source="review", gold_confidence="high", mapped_at="2026-10-12",
             antismash_version="8.0.4", pipeline_version="metaSMASH 1.0.3", taxonomy=None,
             taxonomy_method="orf_lca_v1", new_data_source=None)
    a.update(kw)
    return argparse.Namespace(**a)


GOLD_OK = [("SAMN1", "Environmental:Aquatic:Marine"), ("SAMN2", "Engineered:Wastewater")]


def test_generates_guarded_load_in_fk_order(tmp_path):
    rep = generate(_args(tmp_path, _emit(tmp_path), _gold(tmp_path, GOLD_OK), taxonomy=str(_tax(tmp_path))))
    sql = (tmp_path / "out" / "load.sql").read_text()
    assert rep["stubs"] == [STUB] and rep["new_studies"] == 1 and rep["bgc_taxonomy"] == 1
    assert sql.count("BEGIN;") == 1 and sql.count("COMMIT;") == 1
    # data_sources is asserted, never inserted; stubs are excluded from the studies insert
    assert "INSERT INTO data_sources" not in sql
    assert "WHERE id NOT IN (SELECT id FROM ld_t1_stubs)" in sql and f"('{STUB}')" in sql
    pos = {t: sql.index(f"INSERT INTO {t} (") for t in ("biomes", "studies", "samples", "antismash_runs", "bgcs",
                                                        "study_samples", "sample_biomes", "bgc_taxonomy")}
    assert pos["biomes"] < pos["sample_biomes"] and pos["samples"] < pos["sample_biomes"]
    assert pos["antismash_runs"] < pos["bgcs"] < pos["bgc_taxonomy"]
    assert pos["studies"] < pos["study_samples"]
    assert "ON CONFLICT (id) DO NOTHING" in sql and "ON CONFLICT (gtdb_lineage) DO NOTHING" in sql
    # the fields the emit leaves to the load
    assert "'8.0.4'" in sql and "'metaSMASH 1.0.3'" in sql
    assert '"source": "review"' in sql and "g.gold_ecosystem_path" in sql
    # pre-gates come before the first insert, post-gates after the last
    first_insert = sql.index("INSERT INTO biomes")
    assert sql.index("ids already live") < first_insert
    assert sql.index("samples with a GOLD path") > pos["bgc_taxonomy"]
    gold = (tmp_path / "out" / "gold.tsv").read_text().splitlines()
    assert gold == sorted([f"{S1}\tEnvironmental:Aquatic:Marine", f"{S2}\tEngineered:Wastewater"])


def test_rollback_deletes_children_first_and_spares_shared_rows(tmp_path):
    generate(_args(tmp_path, _emit(tmp_path), _gold(tmp_path, GOLD_OK), taxonomy=str(_tax(tmp_path))))
    rb = (tmp_path / "out" / "rollback.sql").read_text()
    order = [m.group(1) for m in re.finditer(r"DELETE FROM (\w+)", rb)]
    assert order.index("bgc_taxonomy") < order.index("bgcs") < order.index("antismash_runs")
    assert order.index("sample_biomes") < order.index("samples") and order.index("study_samples") < order.index("samples")
    assert order.index("samples") < order.index("studies") and order.index("samples") < order.index("biomes")
    assert "data_sources" not in order
    # derived data attached after the load is refused before any delete, not cascaded away
    first_delete = rb.index("DELETE FROM")
    for t in ("bgc_gcf", "bgc_features", "gcfs", "bgc_gbk_offsets", "gold_path_reclass", "sample_runs",
              "study_biomes", "run_studies"):
        assert rb.index(f"JOIN {t} x") < first_delete, t
    # shared rows: only those this load created and nothing else uses; the rest are kept and listed
    assert "c.kind = 'studies'" in rb and "NOT EXISTS (SELECT 1 FROM study_samples" in rb
    assert "NOT EXISTS (SELECT 1 FROM assembly_taxonomy" in rb
    assert "LOOP" in rb and "GET DIAGNOSTICS n = ROW_COUNT" in rb      # created biome chains, leaves first
    assert "RAISE NOTICE 'biomes: kept" in rb and "created rows still live" not in rb
    drop = (tmp_path / "out" / "drop_staging.sql").read_text()
    assert "ld_t1_created" in drop and "ld_t1_bgcs" in drop


def test_gold_must_cover_exactly_the_staged_samples(tmp_path):
    emit = _emit(tmp_path)
    with pytest.raises(CohortError, match="no path for 1 staged samples"):
        generate(_args(tmp_path, emit, _gold(tmp_path, GOLD_OK[:1])))
    with pytest.raises(CohortError, match="SAMN9 is not a staged sample"):
        generate(_args(tmp_path, emit, _gold(tmp_path, GOLD_OK + [("SAMN9", "Engineered:Wastewater")])))
    with pytest.raises(CohortError, match="listed twice"):
        generate(_args(tmp_path, emit, _gold(tmp_path, GOLD_OK + GOLD_OK[:1])))


def test_gold_paths_are_normalized_and_must_normalize(tmp_path):
    emit = _emit(tmp_path)
    generate(_args(tmp_path, emit, _gold(tmp_path, [("SAMN1", "Environmental:Terrestrial:Peat"),
                                                     ("SAMN2", "Engineered:Wastewater")])))
    assert f"{S1}\tEnvironmental:Terrestrial:Soil:Peat\n" in (tmp_path / "out" / "gold.tsv").read_text()
    with pytest.raises(CohortError, match="does not normalize"):
        generate(_args(tmp_path, emit, _gold(tmp_path, [("SAMN1", ""), ("SAMN2", "Engineered:Wastewater")])))


def test_refuses_count_drift_and_unhandled_tables(tmp_path):
    emit = _emit(tmp_path)
    m = json.loads((emit / "manifest.json").read_text())
    m["tables"]["bgcs"]["row_count"] = 3
    (emit / "manifest.json").write_text(json.dumps(m))
    with pytest.raises(CohortError, match="bgcs: 2 TSV rows, manifest says 3"):
        generate(_args(tmp_path, emit, _gold(tmp_path, GOLD_OK)))

    other = tmp_path / "o"
    other.mkdir()
    emit2 = _emit(other, extra={"runs": [_row("runs", id=ASM, name="r", metadata="{}")]})
    with pytest.raises(CohortError, match="does not handle"):
        generate(_args(other, emit2, _gold(other, GOLD_OK)))


def test_refuses_predictions_outside_the_cohort_and_bad_tags(tmp_path):
    emit = _emit(tmp_path)
    gold = _gold(tmp_path, GOLD_OK)
    with pytest.raises(CohortError, match="not staged bgcs"):
        generate(_args(tmp_path, emit, gold, taxonomy=str(_tax(tmp_path, pred_ids=(B1, "88888888-8888-5888-8888-888888888888")))))
    with pytest.raises(CohortError, match="--tag"):
        generate(_args(tmp_path, emit, gold, tag="Bad-Tag"))


def test_is_stub():
    cols = TABLES["studies"].columns
    blank = {c: N for c in cols}
    assert is_stub({**blank, "id": STUB, "data_source_ids": "{x}", "metadata": "{}"})
    assert not is_stub({**blank, "id": STUB, "study_name": "Seitz"})
    assert not is_stub({**blank, "id": STUB, "metadata": '{"doi": "x"}'})


def test_expect_is_checked_against_the_emit(tmp_path):
    emit = _emit(tmp_path)
    gold = _gold(tmp_path, GOLD_OK)
    with pytest.raises(CohortError, match="bgcs: the emit has 2, --expect says 3"):
        generate(_args(tmp_path, emit, gold, expect=_expect(tmp_path, bgcs=3)))
    with pytest.raises(CohortError, match="stubs: the emit has 1, --expect says 0"):
        generate(_args(tmp_path, emit, gold, expect=_expect(tmp_path, stubs=0)))
    with pytest.raises(CohortError, match="bgc_taxonomy: the emit has 1, --expect says 2"):
        generate(_args(tmp_path, emit, gold, expect=_expect(tmp_path, bgc_taxonomy=2), taxonomy=str(_tax(tmp_path))))
    bare = tmp_path / "bare.json"
    bare.write_text(json.dumps({"bgcs": 2}))
    with pytest.raises(CohortError, match="must give 'samples'"):
        generate(_args(tmp_path, emit, gold, expect=bare))


def test_versions_are_set_and_gated_and_analyze_skips_bgcs(tmp_path):
    generate(_args(tmp_path, _emit(tmp_path), _gold(tmp_path, GOLD_OK)))
    sql = (tmp_path / "out" / "load.sql").read_text()
    assert "x.antismash_version = '8.0.4' AND x.pipeline_version = 'metaSMASH 1.0.3'" in sql
    after = sql[sql.index("COMMIT;"):]
    assert "load committed" in after and "ANALYZE bgcs;" not in after and "ANALYZE samples;" in after


def test_insert_column_lists_match_their_select_lists(tmp_path):
    generate(_args(tmp_path, _emit(tmp_path), _gold(tmp_path, GOLD_OK), taxonomy=str(_tax(tmp_path))))
    sql = (tmp_path / "out" / "load.sql").read_text()
    stmts = re.findall(r"INSERT INTO (\w+) \(([^)]*)\)\s*SELECT (.*?) FROM ", sql, re.S)
    assert len(stmts) >= 10
    for table, cols, sel in stmts:
        sel = re.sub(r"'(?:[^']|'')*'", "''", sel)      # a quoted literal may hold commas
        depth, n = 0, 1
        for ch in sel:
            depth += ch == "("
            depth -= ch == ")"
            n += ch == "," and depth == 0
        assert n == len(cols.split(",")), (table, n, cols)


def test_new_data_source_is_inserted_gated_and_rolled_back(tmp_path):
    emit, gold = _emit(tmp_path), _gold(tmp_path, GOLD_OK)
    generate(_args(tmp_path, emit, gold))
    sql = (tmp_path / "out" / "load.sql").read_text()
    assert "INSERT INTO data_sources" not in sql                      # default: asserted only
    rep = generate(_args(tmp_path, emit, gold, expect=_expect(tmp_path, new_data_sources=1), new_data_source=[DS]))
    assert rep["new_data_sources"] == [DS]
    sql = (tmp_path / "out" / "load.sql").read_text()
    assert f"('{DS}')" in sql and "new data_sources already live" in sql
    assert sql.index("new data_sources already live") < sql.index("INSERT INTO data_sources")
    assert "INSERT INTO ld_t1_created SELECT 'data_sources', id FROM ins;" in sql
    rb = (tmp_path / "out" / "rollback.sql").read_text()
    assert "c.kind = 'data_sources'" in rb and "data_source_ids @> ARRAY[x.id]" in rb
    assert rb.index("DELETE FROM samples") < rb.index("DELETE FROM data_sources")
    assert "ld_t1_new_data_sources" in (tmp_path / "out" / "drop_staging.sql").read_text()


def test_new_data_source_must_be_staged(tmp_path):
    with pytest.raises(CohortError, match="not a staged data source"):
        generate(_args(tmp_path, _emit(tmp_path), _gold(tmp_path, GOLD_OK),
                       new_data_source=["99999999-9999-5999-8999-999999999999"]))


def test_rollback_refuses_rows_attached_after_the_load(tmp_path):
    # no study_samples / sample_biomes staged: a later backfill may add them, and CASCADE would drop them
    emit = _emit(tmp_path, drop=("study_samples", "sample_biomes", "studies"))
    expect = _expect(tmp_path, studies=None)
    e = json.loads(expect.read_text()); e.pop("studies"); e["stubs"] = 0; e["new_studies"] = 0
    expect.write_text(json.dumps(e))
    generate(_args(tmp_path, emit, _gold(tmp_path, GOLD_OK), expect=expect))
    rb = (tmp_path / "out" / "rollback.sql").read_text()
    first_delete = rb.index("DELETE FROM")
    for t in ("study_samples", "sample_biomes", "sample_measurements", "bgc_taxonomy"):
        assert rb.index(f"JOIN {t} x") < first_delete, t
    sql = (tmp_path / "out" / "load.sql").read_text()
    assert "emitted GOLD paths that differ from --gold" in sql
