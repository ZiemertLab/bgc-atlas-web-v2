from scripts.populator.validate import validate_tables

def test_detects_orphan_fk():
    tables = {
        "assemblies": [{"id": "A1", "accession": "a"}],
        "bgcs": [{"id": "B1", "filename": "f", "assembly": "MISSING",
                  "start_pos": 0, "end_pos": 10}],
    }
    report = validate_tables(tables)
    assert not report.ok
    assert any(i["kind"] == "orphan_fk" and i["table"] == "bgcs" for i in report.issues)

def test_detects_duplicate_pk():
    tables = {"data_sources": [{"id": "g", "name": "x"}, {"id": "g", "name": "y"}]}
    report = validate_tables(tables)
    assert any(i["kind"] == "duplicate_pk" and i["table"] == "data_sources" for i in report.issues)

def test_clean_tables_pass():
    tables = {"assemblies": [{"id": "A1", "accession": "a"}],
              "bgcs": [{"id": "B1", "filename": "f", "assembly": "A1",
                        "start_pos": 0, "end_pos": 10}]}
    assert validate_tables(tables).ok

def test_detects_bad_core_coordinates():
    tables = {"bgcs": [{"id": "B1", "filename": "f", "start_pos": 100, "end_pos": 500,
                        "core_start_pos": 50, "core_end_pos": 400}]}   # core_start < start
    report = validate_tables(tables)
    assert any(i["kind"] == "domain" and i.get("rule") == "chk_core_coordinates"
               for i in report.issues)

def test_core_end_null_with_core_start_passes():
    # mirrors Postgres: a NULL CHECK result passes
    tables = {"bgcs": [{"id": "B1", "filename": "f", "start_pos": 0, "end_pos": 500,
                        "core_start_pos": 50, "core_end_pos": None}]}
    assert validate_tables(tables).ok

def test_detects_bad_source_type():
    tables = {"assemblies": [{"id": "A1", "accession": "a", "source_type": "weird"}]}
    report = validate_tables(tables)
    assert any(i["kind"] == "domain" and i.get("rule") == "source_type_enum"
               for i in report.issues)

def test_detects_negative_membership():
    tables = {"bgcs": [{"id": "B1", "filename": "f", "start_pos": 0, "end_pos": 10,
                        "gcf_membership": -0.5}]}
    report = validate_tables(tables)
    assert any(i["kind"] == "domain" and i.get("rule") == "gcf_membership>=0"
               for i in report.issues)

def test_membership_above_one_passes():
    # no upper bound since migration 0011
    tables = {"bgcs": [{"id": "B1", "filename": "f", "start_pos": 0, "end_pos": 10,
                        "gcf_membership": 1.5}]}
    assert validate_tables(tables).ok

def test_report_partitions_hard_vs_domain():
    tables = {"assemblies": [{"id": "A1", "accession": "a", "source_type": "weird"}],
              "data_sources": [{"id": "g", "name": "x"}, {"id": "g", "name": "y"}]}
    r = validate_tables(tables)
    assert any(i["kind"] == "duplicate_pk" for i in r.hard_errors)
    assert any(i.get("rule") == "source_type_enum" for i in r.domain_issues)
    assert not r.ok

def test_detects_negative_start_pos():
    tables = {"bgcs": [{"id": "B1", "filename": "f", "start_pos": -5, "end_pos": 10}]}
    report = validate_tables(tables)
    assert any(i["kind"] == "domain" and i.get("rule") == "start_pos>=0"
               for i in report.issues)

def test_detects_start_gt_end():
    tables = {"bgcs": [{"id": "B1", "filename": "f", "start_pos": 50, "end_pos": 10}]}
    report = validate_tables(tables)
    assert any(i["kind"] == "domain" and i.get("rule") == "start_pos<=end_pos"
               for i in report.issues)

def test_detects_bad_rank_depth():
    tables = {"taxonomies": [{"id": "T1", "gtdb_lineage": "d__Bacteria",
                              "rank_depth": 8}]}
    report = validate_tables(tables)
    assert any(i["kind"] == "domain" and i.get("rule") == "chk_rank_depth"
               for i in report.issues)


def test_valid_rank_depth_passes():
    tables = {"taxonomies": [{"id": "T1", "gtdb_lineage": "d__Bacteria",
                              "rank_depth": 7}]}
    assert validate_tables(tables).ok


def test_skips_fk_when_parent_table_absent():
    tables = {"bgcs": [{"id": "B1", "filename": "f", "assembly": "X",
                        "start_pos": 0, "end_pos": 10}]}
    report = validate_tables(tables)
    assert not any(i["kind"] == "orphan_fk" for i in report.issues)

def test_null_fk_not_orphan():
    tables = {"bgcs": [{"id": "B1", "filename": "f", "assembly": None,
                        "start_pos": 0, "end_pos": 10}],
              "assemblies": []}
    report = validate_tables(tables)
    assert not any(i["kind"] == "orphan_fk" for i in report.issues)


def test_data_source_ids_membership_guard():
    # guards drift between _PROVENANCE names and the names adapters emit
    from scripts.populator.validate import validate_tables
    from scripts.populator import ids
    mid = str(ids.entity_id("data_sources", "metalog"))
    ghost = str(ids.entity_id("data_sources", "GHOST"))
    tables = {
        "data_sources": [{"id": mid, "name": "metalog"}],
        "samples": [{"id": "s1", "external_id": "x", "data_source_ids": [mid, ghost]}],
    }
    rep = validate_tables(tables)
    assert not rep.ok
    bad = [i for i in rep.hard_errors
           if i["column"] == "data_source_ids" and i["value"] == ghost]
    assert len(bad) == 1 and bad[0]["parent"] == "data_sources"


def test_data_source_ids_membership_ok_when_resolved():
    from scripts.populator.validate import validate_tables
    from scripts.populator import ids
    mid = str(ids.entity_id("data_sources", "metalog"))
    sid = str(ids.entity_id("data_sources", "SPIRE"))
    tables = {
        "data_sources": [{"id": mid, "name": "metalog"}, {"id": sid, "name": "SPIRE"}],
        "samples": [{"id": "s1", "external_id": "x", "data_source_ids": [mid, sid]}],
        "assemblies": [{"id": "a1", "accession": "x", "source_type": "metagenome",
                        "data_source_ids": [sid]}],          # SPIRE-only, resolves
    }
    assert validate_tables(tables).ok
