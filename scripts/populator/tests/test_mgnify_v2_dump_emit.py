"""Tests for the native-v2 MGnify emitters: they must produce the same Records the
v1 emitters did, reading v2 fields."""
import json

from scripts.populator.adapters.mgnify_v2_dump_emit import (
    emit_sample, emit_assembly, emit_run, emit_study, emit_analysis,
)
from scripts.populator import ids
from scripts.populator.core.registry import Registry
from scripts.populator.validate import validate_tables

SAMEA2SEC = {"SAMEA1": "ERS1"}


SAMPLE = {
    "accession": "SAMEA8898481",
    "ena_accessions": ["SAMEA8898481", "ERS6581385"],
    "sample_title": "Puna hot spring water",
    "updated_at": "2026-04-30T12:00:00Z",
    "biome": {
        "biome_name": "Hot (42-90C)",
        "lineage": "root:Environmental:Aquatic:Thermal springs:Hot (42-90C)",
    },
    "metadata": {
        "lat": "-26.0345",
        "lon": "-66.9876",
        "country": "Argentina",
        "collection_date": "2019",
        "collection_date_start": "2019-01-01",
        "collection_date_end": "2019-12-31",
        "environment_biome": "Puna",
        "environment_feature": "Hot Spring",
        "environment_material": "water",
        "broad_scale_environmental_context": "Puna",
        "local_environmental_context": "Hot Spring",
        "environmental_medium": "water",
        "elevation": "4828.0",
        "depth": "0",
        "ph": "",
        "temperature": "",
        "salinity": "",
        "host_tax_id": "",
        "tax_id": "256318",
        "scientific_name": "metagenome",
        "sample_alias": "puna-01",
        "sample_title": "Puna hot spring water",
        "sample_description": "Water from a Puna hot spring.",
    },
}


def _emit_sample_fields(data):
    recs = list(emit_sample(data))
    samp = [r for r in recs if r.table == "samples"]
    assert len(samp) == 1
    return recs, samp[0].fields


def test_emit_sample_columns_full():
    recs, f = _emit_sample_fields(SAMPLE)
    assert f["external_id"] == "ERS6581385"
    assert f["accession"] == "ERS6581385"
    samp = [r for r in recs if r.table == "samples"][0]
    assert samp.natural_key == "mgnify|ERS6581385"

    assert f["name"] == "Puna hot spring water"
    assert f["sample_alias"] == "puna-01"
    assert f["geographic_location"] == "Argentina"
    assert f["latitude"] == -26.0345 and isinstance(f["latitude"], float)
    assert f["longitude"] == -66.9876 and isinstance(f["longitude"], float)
    assert f["collection_date"] == "2019-01-01"
    assert f["collection_date_end"] == "2019-12-31"
    assert f["environment_biome"] == "Puna"
    assert f["environment_feature"] == "Hot Spring"
    assert f["environment_material"] == "water"
    assert f["elevation_meters"] == 4828.0 and isinstance(f["elevation_meters"], float)
    assert f["depth"] == 0.0 and isinstance(f["depth"], float)
    assert f["host_scientific_name"] == "metagenome"

    # data_source_ids is tagged downstream by the orchestrator
    assert "data_source_ids" not in f


def test_emit_sample_metadata_jsonb_4_keys():
    _, f = _emit_sample_fields(SAMPLE)
    meta = json.loads(f["metadata"])
    assert set(meta.keys()) == {"biosample", "last_update", "raw_metadata",
                                "analysis_completed"}
    assert meta["biosample"] == "SAMEA8898481"
    assert meta["last_update"] == "2026-04-30T12:00:00Z"
    assert meta["analysis_completed"] is None
    rm = meta["raw_metadata"]
    assert rm["lat"] == {"unit": None, "value": "-26.0345"}
    assert rm["lon"] == {"unit": None, "value": "-66.9876"}
    assert rm["country"] == {"unit": None, "value": "Argentina"}
    assert "ph" not in rm
    assert "temperature" not in rm
    assert "salinity" not in rm
    assert "host_tax_id" not in rm


def test_emit_sample_biome_tree_and_sample_biomes():
    recs = list(emit_sample(SAMPLE))
    by_table = {}
    for r in recs:
        by_table.setdefault(r.table, []).append(r)

    biomes = by_table["biomes"]
    by_name = {r.natural_key: r for r in biomes}
    assert set(by_name) == {
        "root",
        "root:Environmental",
        "root:Environmental:Aquatic",
        "root:Environmental:Aquatic:Thermal springs",
        "root:Environmental:Aquatic:Thermal springs:Hot (42-90C)",
    }
    assert by_name["root"].fields == {"name": "root", "level": 0}
    assert by_name["root"].refs == {}
    assert by_name["root:Environmental"].refs == {"parent_id": ("biomes", "root")}
    leaf = "root:Environmental:Aquatic:Thermal springs:Hot (42-90C)"
    assert by_name[leaf].fields["level"] == 4
    assert by_name[leaf].refs == {
        "parent_id": ("biomes", "root:Environmental:Aquatic:Thermal springs")}

    sb = by_table["sample_biomes"]
    assert len(sb) == 1
    assert sb[0].natural_key == f"mgnify|ERS6581385|{leaf}"
    assert sb[0].refs == {"sample_id": ("samples", "mgnify|ERS6581385"),
                          "biome_id": ("biomes", leaf)}


def test_emit_sample_empty_numerics_omitted():
    _, f = _emit_sample_fields(SAMPLE)
    assert "ph" not in f
    assert "temperature" not in f
    assert "host_taxid" not in f


def test_emit_sample_keys_by_samea_when_no_secondary():
    data = json.loads(json.dumps(SAMPLE))
    data["ena_accessions"] = ["SAMEA8898481"]
    _, f = _emit_sample_fields(data)
    assert f["external_id"] == "SAMEA8898481"
    assert f["accession"] == "SAMEA8898481"
    samp = [r for r in emit_sample(data) if r.table == "samples"][0]
    assert samp.natural_key == "mgnify|SAMEA8898481"
    assert json.loads(f["metadata"])["biosample"] == "SAMEA8898481"


def test_emit_sample_no_biome_still_emits_sample():
    data = json.loads(json.dumps(SAMPLE))
    data["biome"] = None
    recs = list(emit_sample(data))
    tables = {r.table for r in recs}
    assert "samples" in tables
    assert "biomes" not in tables
    assert "sample_biomes" not in tables


def test_emit_sample_own_biome_takes_precedence_over_study():
    data = json.loads(json.dumps(SAMPLE))
    data["studies"] = [{
        "accession": "MGYS_OTHER",
        "biome": {"lineage": "root:Environmental:Terrestrial:Soil"},
    }]
    recs = list(emit_sample(data))
    by_table = {}
    for r in recs:
        by_table.setdefault(r.table, []).append(r)
    by_name = {r.natural_key for r in by_table["biomes"]}
    leaf = "root:Environmental:Aquatic:Thermal springs:Hot (42-90C)"
    assert leaf in by_name
    assert "root:Environmental:Terrestrial:Soil" not in by_name
    sb = by_table["sample_biomes"]
    assert len(sb) == 1
    assert sb[0].refs["biome_id"] == ("biomes", leaf)


def test_emit_sample_falls_back_to_study_biome():
    data = json.loads(json.dumps(SAMPLE))
    data["biome"] = None
    data["studies"] = [{
        "accession": "MGYS1",
        "biome": {"lineage": "root:Environmental:Terrestrial:Soil"},
    }]
    recs = list(emit_sample(data))
    by_table = {}
    for r in recs:
        by_table.setdefault(r.table, []).append(r)
    by_name = {r.natural_key for r in by_table["biomes"]}
    assert by_name == {
        "root",
        "root:Environmental",
        "root:Environmental:Terrestrial",
        "root:Environmental:Terrestrial:Soil",
    }
    sb = by_table["sample_biomes"]
    assert len(sb) == 1
    leaf = "root:Environmental:Terrestrial:Soil"
    assert sb[0].natural_key == f"mgnify|ERS6581385|{leaf}"
    assert sb[0].refs == {"sample_id": ("samples", "mgnify|ERS6581385"),
                          "biome_id": ("biomes", leaf)}


def test_emit_sample_falls_back_to_first_study_with_biome():
    data = json.loads(json.dumps(SAMPLE))
    data["biome"] = None
    data["studies"] = [
        {"accession": "MGYS_NO_BIOME", "biome": None},
        {"accession": "MGYS1",
         "biome": {"lineage": "root:Environmental:Terrestrial:Soil"}},
    ]
    recs = list(emit_sample(data))
    by_table = {}
    for r in recs:
        by_table.setdefault(r.table, []).append(r)
    sb = by_table["sample_biomes"]
    assert len(sb) == 1
    assert sb[0].refs["biome_id"] == ("biomes", "root:Environmental:Terrestrial:Soil")


def test_emit_sample_study_present_but_no_biome_no_biome_records():
    data = json.loads(json.dumps(SAMPLE))
    data["biome"] = None
    data["studies"] = [
        {"accession": "MGYS_A", "biome": None},
        {"accession": "MGYS_B"},
    ]
    recs = list(emit_sample(data))
    tables = {r.table for r in recs}
    assert "samples" in tables
    assert "biomes" not in tables
    assert "sample_biomes" not in tables


def test_emit_sample_no_biome_no_studies_key_no_crash():
    data = json.loads(json.dumps(SAMPLE))
    data["biome"] = None
    data.pop("studies", None)
    recs = list(emit_sample(data))
    tables = {r.table for r in recs}
    assert "samples" in tables
    assert "biomes" not in tables
    assert "sample_biomes" not in tables


def test_emit_sample_collection_date_gating():
    data = json.loads(json.dumps(SAMPLE))
    del data["metadata"]["collection_date_start"]
    data["metadata"]["collection_date"] = "2020-05-05"
    _, f = _emit_sample_fields(data)
    assert f["collection_date"] == "2020-05-05"

    data2 = json.loads(json.dumps(SAMPLE))
    del data2["metadata"]["collection_date_start"]
    data2["metadata"]["collection_date"] = "2019"
    _, f2 = _emit_sample_fields(data2)
    assert "collection_date" not in f2

    data3 = json.loads(json.dumps(SAMPLE))
    data3["metadata"]["collection_date_end"] = "2019"
    _, f3 = _emit_sample_fields(data3)
    assert "collection_date_end" not in f3


def test_emit_sample_environment_fallback_to_context_fields():
    data = json.loads(json.dumps(SAMPLE))
    del data["metadata"]["environment_biome"]
    del data["metadata"]["environment_feature"]
    del data["metadata"]["environment_material"]
    _, f = _emit_sample_fields(data)
    assert f["environment_biome"] == "Puna"
    assert f["environment_feature"] == "Hot Spring"
    assert f["environment_material"] == "water"


def test_emit_sample_no_key_emits_nothing():
    assert list(emit_sample({"ena_accessions": []})) == []
    assert list(emit_sample({})) == []


def test_finalize_roundtrip_and_validate():
    reg = Registry()
    for r in emit_sample(SAMPLE):
        reg.add(r)
    finalized = reg.finalize()

    samp_row = finalized["samples"][0]
    assert samp_row["id"]
    samp_id = samp_row["id"]
    assert finalized["sample_biomes"][0]["sample_id"] == samp_id
    assert samp_id == str(ids.entity_id("samples", "mgnify|ERS6581385"))

    report = validate_tables(finalized)
    assert report.hard_errors == []


ASSEMBLY = {
    "accession": "ERZ123",
    "updated_at": "2026-04-30T12:00:00Z",
    "run_accession": "ERR9",
    "sample_accession": "SAMEA1",
    "reads_study_accession": "ERP1",
    "assembly_study_accession": "MGYS1",
    "assembler_name": "metaspades",
    "assembler_version": "3.15",
    "metadata": {"foo": "bar"},
    "status": "completed",
}


def _by_table(recs):
    out = {}
    for r in recs:
        out.setdefault(r.table, []).append(r)
    return out


def test_emit_assembly_entity_record():
    recs = list(emit_assembly(ASSEMBLY, SAMEA2SEC))
    by = _by_table(recs)
    asm = by["assemblies"]
    assert len(asm) == 1
    rec = asm[0]
    assert rec.natural_key == "mgnify|ERZ123"
    f = rec.fields
    assert f["accession"] == "ERZ123"
    assert f["external_id"] == "ERZ123"
    assert f["name"] is None
    assert f["source_type"] == "metagenome"
    assert "data_source_ids" not in f
    assert rec.refs == {}
    meta = json.loads(f["metadata"])
    assert meta == {
        "assembler_name": "metaspades",
        "assembler_version": "3.15",
        "reads_study_accession": "ERP1",
        "assembly_study_accession": "MGYS1",
        "status": "completed",
        "updated_at": "2026-04-30T12:00:00Z",
        "mgnify_v2": True,
    }
    assert ids.entity_id("assemblies", "mgnify|ERZ123")


def test_emit_assembly_run_assemblies_key_order():
    recs = list(emit_assembly(ASSEMBLY, SAMEA2SEC))
    ra = _by_table(recs)["run_assemblies"]
    assert len(ra) == 1
    assert ra[0].natural_key == "mgnify|ERR9|mgnify|ERZ123"
    assert ra[0].fields == {}
    assert ra[0].refs == {"run_id": ("runs", "mgnify|ERR9"),
                          "assembly_id": ("assemblies", "mgnify|ERZ123")}


def test_emit_assembly_sample_assemblies_translated_key():
    recs = list(emit_assembly(ASSEMBLY, SAMEA2SEC))
    sa = _by_table(recs)["sample_assemblies"]
    assert len(sa) == 1
    # SAMEA1 is translated to its secondary ERS1
    assert sa[0].natural_key == "mgnify|ERS1|mgnify|ERZ123"
    assert sa[0].refs == {"sample_id": ("samples", "mgnify|ERS1"),
                          "assembly_id": ("assemblies", "mgnify|ERZ123")}


def test_emit_assembly_sample_not_in_map_falls_back_to_samea():
    data = dict(ASSEMBLY, sample_accession="SAMEA999")
    sa = _by_table(list(emit_assembly(data, SAMEA2SEC)))["sample_assemblies"]
    assert sa[0].natural_key == "mgnify|SAMEA999|mgnify|ERZ123"
    assert sa[0].refs["sample_id"] == ("samples", "mgnify|SAMEA999")


def test_emit_assembly_missing_linkage_omits_junctions():
    data = dict(ASSEMBLY)
    data["run_accession"] = None
    data["sample_accession"] = None
    by = _by_table(list(emit_assembly(data, SAMEA2SEC)))
    assert "run_assemblies" not in by
    assert "sample_assemblies" not in by
    assert len(by["assemblies"]) == 1


def test_emit_assembly_no_accession_emits_nothing():
    assert list(emit_assembly({"accession": ""}, SAMEA2SEC)) == []
    assert list(emit_assembly({}, SAMEA2SEC)) == []


RUN = {
    "accession": "ERR9",
    "experiment_type": "metagenomic",
    "sample_accession": "SAMEA1",
    "study_accession": "MGYS1",
    "instrument_model": "Illumina HiSeq 2500",
    "instrument_platform": "ILLUMINA",
}


def test_emit_run_entity_record():
    recs = list(emit_run(RUN, SAMEA2SEC))
    rec = _by_table(recs)["runs"][0]
    assert rec.natural_key == "mgnify|ERR9"
    f = rec.fields
    assert f["accession"] == "ERR9"
    assert f["instrument_model"] == "Illumina HiSeq 2500"
    assert f["instrument_platform"] == "ILLUMINA"
    assert "data_source_ids" not in f
    assert "external_id" not in f
    assert "name" not in f
    assert "secondary_accession" not in f
    assert rec.refs == {}
    meta = json.loads(f["metadata"])
    assert meta == {
        "experiment_type": "metagenomic",
        "study_accession": "MGYS1",
        "sample_accession": "SAMEA1",
        "mgnify_v2": True,
    }
    assert ids.entity_id("runs", "mgnify|ERR9")


def test_emit_run_sample_runs_translated_key():
    sr = _by_table(list(emit_run(RUN, SAMEA2SEC)))["sample_runs"]
    assert len(sr) == 1
    # SAMEA1 -> ERS1
    assert sr[0].natural_key == "mgnify|ERS1|mgnify|ERR9"
    assert sr[0].refs == {"sample_id": ("samples", "mgnify|ERS1"),
                          "run_id": ("runs", "mgnify|ERR9")}


def test_emit_run_run_studies_key_order():
    rs = _by_table(list(emit_run(RUN, SAMEA2SEC)))["run_studies"]
    assert len(rs) == 1
    assert rs[0].natural_key == "mgnify|ERR9|mgnify|MGYS1"
    assert rs[0].refs == {"run_id": ("runs", "mgnify|ERR9"),
                          "study_id": ("studies", "mgnify|MGYS1")}


def test_emit_run_sample_not_in_map_falls_back():
    data = dict(RUN, sample_accession="SAMEA999")
    sr = _by_table(list(emit_run(data, SAMEA2SEC)))["sample_runs"]
    assert sr[0].natural_key == "mgnify|SAMEA999|mgnify|ERR9"


def test_emit_run_missing_linkage_omits_junctions():
    data = dict(RUN, sample_accession=None, study_accession=None)
    by = _by_table(list(emit_run(data, SAMEA2SEC)))
    assert "sample_runs" not in by
    assert "run_studies" not in by
    assert len(by["runs"]) == 1


def test_emit_run_no_accession_emits_nothing():
    assert list(emit_run({"accession": ""}, SAMEA2SEC)) == []
    assert list(emit_run({}, SAMEA2SEC)) == []


STUDY = {
    "accession": "MGYS1",
    "ena_accessions": ["ERP1"],
    "title": "A study of hot springs",
    "biome": {
        "biome_name": "Hot (42-90C)",
        "lineage": "root:Environmental:Aquatic:Thermal springs:Hot (42-90C)",
    },
    "updated_at": "2026-04-30T12:00:00Z",
    "metadata": {"foo": "bar"},
    "first_accession": "ERP1",
}


def test_emit_study_entity_record():
    recs = list(emit_study(STUDY))
    rec = _by_table(recs)["studies"][0]
    assert rec.natural_key == "mgnify|MGYS1"
    f = rec.fields
    assert f["accession"] == "MGYS1"
    assert f["study_name"] == "A study of hot springs"
    assert f["title"] == "A study of hot springs"
    assert "external_id" not in f
    assert rec.refs == {}
    meta = json.loads(f["metadata"])
    assert meta == {
        "updated_at": "2026-04-30T12:00:00Z",
        "first_accession": "ERP1",
        "mgnify_v2": True,
    }
    assert f["biome_ids"] == [str(ids.entity_id(
        "biomes", "root:Environmental:Aquatic:Thermal springs:Hot (42-90C)"))]
    assert ids.entity_id("studies", "mgnify|MGYS1")


def test_emit_study_biome_tree():
    recs = list(emit_study(STUDY))
    biomes = _by_table(recs)["biomes"]
    by_name = {r.natural_key: r for r in biomes}
    assert set(by_name) == {
        "root",
        "root:Environmental",
        "root:Environmental:Aquatic",
        "root:Environmental:Aquatic:Thermal springs",
        "root:Environmental:Aquatic:Thermal springs:Hot (42-90C)",
    }
    assert by_name["root"].fields == {"name": "root", "level": 0}
    assert by_name["root"].refs == {}
    assert by_name["root:Environmental"].refs == {"parent_id": ("biomes", "root")}


def test_emit_study_no_title_omits_name_and_title():
    data = dict(STUDY, title=None)
    f = _by_table(list(emit_study(data)))["studies"][0].fields
    assert "study_name" not in f
    assert "title" not in f


def test_emit_study_null_biome_no_biome_records():
    data = dict(STUDY, biome=None)
    by = _by_table(list(emit_study(data)))
    assert "biomes" not in by
    assert "biome_ids" not in by["studies"][0].fields


def test_emit_study_no_accession_emits_nothing():
    assert list(emit_study({"accession": ""})) == []
    assert list(emit_study({})) == []


ANALYSIS = {
    "accession": "MGYA1",
    "experiment_type": "assembly",
    "study_accession": "MGYS1",
    "run": {"accession": "ERR9"},
    "sample": {"accession": "SAMEA1"},
    "assembly": {"accession": "ERZ123"},
    "pipeline_version": "5.0",
}


def test_emit_analysis_entity_record():
    recs = list(emit_analysis(ANALYSIS, SAMEA2SEC))
    rec = _by_table(recs)["analyses"][0]
    assert rec.natural_key == "mgnify|MGYA1"
    f = rec.fields
    assert f["accession"] == "MGYA1"
    assert f["name"] == "MGYA1"
    assert f["analysis_type"] == "assembly"
    assert f["tool_name"] == ""
    assert "external_id" not in f
    assert "data_source_ids" not in f
    assert rec.refs == {}
    meta = json.loads(f["metadata"])
    assert meta == {
        "pipeline_version": "5.0",
        "study_accession": "MGYS1",
        "mgnify_v2": True,
    }
    assert ids.entity_id("analyses", "mgnify|MGYA1")


def test_emit_analysis_sample_analyses_translated_key():
    sa = _by_table(list(emit_analysis(ANALYSIS, SAMEA2SEC)))["sample_analyses"]
    assert len(sa) == 1
    # SAMEA1 -> ERS1
    assert sa[0].natural_key == "mgnify|ERS1|mgnify|MGYA1"
    assert sa[0].refs == {"sample_id": ("samples", "mgnify|ERS1"),
                          "analysis_id": ("analyses", "mgnify|MGYA1")}


def test_emit_analysis_assembly_analyses_key_order():
    aa = _by_table(list(emit_analysis(ANALYSIS, SAMEA2SEC)))["assembly_analyses"]
    assert len(aa) == 1
    # assembly accession is used directly, without translation
    assert aa[0].natural_key == "mgnify|ERZ123|mgnify|MGYA1"
    assert aa[0].refs == {"assembly_id": ("assemblies", "mgnify|ERZ123"),
                          "analysis_id": ("analyses", "mgnify|MGYA1")}


def test_emit_analysis_run_analyses_key_order():
    ra = _by_table(list(emit_analysis(ANALYSIS, SAMEA2SEC)))["run_analyses"]
    assert len(ra) == 1
    assert ra[0].natural_key == "mgnify|ERR9|mgnify|MGYA1"
    assert ra[0].refs == {"run_id": ("runs", "mgnify|ERR9"),
                          "analysis_id": ("analyses", "mgnify|MGYA1")}


def test_emit_analysis_only_sample_uses_translation():
    m = {"SAMEA1": "ERS1", "ERR9": "SHOULD_NOT_BE_USED",
         "ERZ123": "SHOULD_NOT_BE_USED"}
    by = _by_table(list(emit_analysis(ANALYSIS, m)))
    assert by["run_analyses"][0].natural_key == "mgnify|ERR9|mgnify|MGYA1"
    assert by["assembly_analyses"][0].natural_key == "mgnify|ERZ123|mgnify|MGYA1"
    assert by["sample_analyses"][0].natural_key == "mgnify|ERS1|mgnify|MGYA1"


def test_emit_analysis_sample_not_in_map_falls_back():
    data = dict(ANALYSIS, sample={"accession": "SAMEA999"})
    sa = _by_table(list(emit_analysis(data, SAMEA2SEC)))["sample_analyses"]
    assert sa[0].natural_key == "mgnify|SAMEA999|mgnify|MGYA1"


def test_emit_analysis_missing_linkage_omits_junctions():
    data = dict(ANALYSIS, run=None, sample=None, assembly=None)
    by = _by_table(list(emit_analysis(data, SAMEA2SEC)))
    assert "sample_analyses" not in by
    assert "assembly_analyses" not in by
    assert "run_analyses" not in by
    assert len(by["analyses"]) == 1


def test_emit_analysis_empty_nested_accession_omits_junction():
    data = dict(ANALYSIS, run={"accession": ""}, sample={"accession": None},
                assembly={})
    by = _by_table(list(emit_analysis(data, SAMEA2SEC)))
    assert "sample_analyses" not in by
    assert "assembly_analyses" not in by
    assert "run_analyses" not in by


def test_emit_analysis_no_accession_emits_nothing():
    assert list(emit_analysis({"accession": ""}, SAMEA2SEC)) == []
    assert list(emit_analysis({}, SAMEA2SEC)) == []
