from scripts.populator import schema
from scripts.populator.validate import validate_tables


def test_runs_and_junctions_declared():
    for t in ("runs", "sample_runs", "run_assemblies", "run_analyses", "run_studies"):
        assert t in schema.TABLES


def test_runs_columns_match_production_ddl():
    cols = schema.TABLES["runs"].columns
    for c in ("id", "external_id", "name", "instrument_model", "instrument_platform",
              "accession", "secondary_accession", "metadata"):
        assert c in cols
    # created_at/updated_at are omitted so DB defaults fill them
    assert "created_at" not in cols and "updated_at" not in cols
    assert schema.TABLES["runs"].natural_key_cols == ("accession",)
    assert schema.TABLES["runs"].none_defaults["metadata"] == "{}"
    assert "data_source_ids" not in cols


def test_run_junction_fks_declared():
    assert schema.TABLES["sample_runs"].fks == {"sample_id": "samples", "run_id": "runs"}
    assert schema.TABLES["run_assemblies"].fks == {"run_id": "runs", "assembly_id": "assemblies"}
    assert schema.TABLES["run_analyses"].fks == {"run_id": "runs", "analysis_id": "analyses"}
    assert schema.TABLES["run_studies"].fks == {"run_id": "runs", "study_id": "studies"}
    for t in ("sample_runs", "run_assemblies", "run_analyses", "run_studies"):
        assert "id" not in schema.TABLES[t].columns


def test_load_order_places_runs_before_junctions():
    order = schema.load_order()
    for t in ("runs", "sample_runs", "run_assemblies", "run_analyses", "run_studies"):
        assert t in order
    # each junction is ordered after BOTH of its FK parents
    assert order.index("runs") < order.index("sample_runs")
    assert order.index("samples") < order.index("sample_runs")
    assert order.index("runs") < order.index("run_assemblies")
    assert order.index("assemblies") < order.index("run_assemblies")
    assert order.index("runs") < order.index("run_analyses")
    assert order.index("analyses") < order.index("run_analyses")
    assert order.index("runs") < order.index("run_studies")
    assert order.index("studies") < order.index("run_studies")


def test_validate_accepts_runs_and_sample_runs():
    rid = "00000000-0000-0000-0000-000000000001"
    sid = "00000000-0000-0000-0000-000000000002"
    tables = {
        "runs": [{"id": rid, "accession": "SRR1"}],
        "samples": [{"id": sid, "external_id": "ERS1"}],
        "sample_runs": [{"sample_id": sid, "run_id": rid}],
    }
    report = validate_tables(tables)
    assert report.ok


def test_validate_detects_orphan_run_fk():
    rid = "00000000-0000-0000-0000-000000000001"
    sid = "00000000-0000-0000-0000-000000000002"
    tables = {
        "runs": [{"id": rid, "accession": "SRR1"}],
        "samples": [{"id": sid, "external_id": "ERS1"}],
        "sample_runs": [{"sample_id": sid, "run_id": "MISSING"}],
    }
    report = validate_tables(tables)
    assert not report.ok
    assert any(i["kind"] == "orphan_fk" and i["table"] == "sample_runs"
               and i["column"] == "run_id" for i in report.issues)
