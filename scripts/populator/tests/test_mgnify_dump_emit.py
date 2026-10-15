import json

from scripts.populator.adapters.mgnify_dump_emit import (
    _assembly_metadata, emit_assembly, _analysis_metadata, emit_analysis,
    _analysis_summary, _run_metadata, emit_run,
    emit_sample, emit_study, _sample_metadata, _raw_metadata,
    _clean, _qstrip, _sentinel,
)
from scripts.populator import ids
from scripts.populator.core.registry import Registry
from scripts.populator.validate import validate_tables


ASM = {
    "id": "ERZ724552",
    "attributes": {"experiment-type": "assembly", "is-private": False,
                   "accession": "ERZ724552", "wgs-accession": "UOSD01",
                   "legacy-accession": "GCA_900565475", "coverage": None,
                   "min-gap-length": None},
    "links": {"self": "https://www.ebi.ac.uk/metagenomics/api/v1/assemblies/ERZ724552"},
    "relationships": {
        "pipelines": {"data": [{"type": "pipelines", "id": "4.1"}]},
        "samples": {"data": [{"type": "samples", "id": "SRS2278353"}]},
        "runs": {"data": [{"type": "runs", "id": "SRR5676449"}],
                 "links": {"related": "https://x/assemblies/ERZ724552/runs"}},
        "analyses": {"links": {"related": "https://www.ebi.ac.uk/metagenomics/api/v1/assemblies/ERZ724552/analyses"}},
    },
}

EXPECTED_META = {
    "coverage": None, "is_private": False,
    "mgnify_links": {"self": "https://www.ebi.ac.uk/metagenomics/api/v1/assemblies/ERZ724552"},
    "wgs_accession": "UOSD01", "min_gap_length": None, "experiment_type": "assembly",
    "legacy_accession": "GCA_900565475",
    "relationships_metadata": {"sample_ids": ["SRS2278353"], "pipeline_ids": ["4.1"],
        "run_ids": ["SRR5676449"],
        "analyses_link": "https://www.ebi.ac.uk/metagenomics/api/v1/assemblies/ERZ724552/analyses"}}


def test_assembly_metadata_exact():
    assert _assembly_metadata(ASM) == EXPECTED_META


def test_relationships_metadata_omits_empty():
    asm2 = {
        "id": "ERZ_EMPTY",
        "attributes": {"accession": "ERZ_EMPTY"},
        "links": {"self": "https://x/assemblies/ERZ_EMPTY"},
        "relationships": {},
    }
    assert _assembly_metadata(asm2)["relationships_metadata"] == {}
    asm3 = {
        "id": "ERZ_EMPTY2",
        "attributes": {"accession": "ERZ_EMPTY2"},
        "relationships": {
            "runs": {"data": []}, "samples": {"data": []}, "pipelines": {"data": []},
            "analyses": {"links": {}},
        },
    }
    assert _assembly_metadata(asm3)["relationships_metadata"] == {}


def test_emit_assembly_records():
    recs = list(emit_assembly("ERZ724552", ASM))
    by_table = {}
    for r in recs:
        by_table.setdefault(r.table, []).append(r)

    assert len(by_table["assemblies"]) == 1
    assert len(by_table["run_assemblies"]) == 1
    assert len(by_table["sample_assemblies"]) == 1
    assert len(recs) == 3

    asm = by_table["assemblies"][0]
    assert asm.natural_key == "mgnify|ERZ724552"
    assert asm.fields["name"] is None
    assert "name" in asm.fields
    assert asm.fields["external_id"] == "ERZ724552"
    assert asm.fields["accession"] == "ERZ724552"
    assert asm.fields["source_type"] == "metagenome"
    assert "data_source_ids" not in asm.fields
    assert json.loads(asm.fields["metadata"]) == EXPECTED_META

    ra = by_table["run_assemblies"][0]
    assert ra.natural_key == "mgnify|SRR5676449|mgnify|ERZ724552"
    assert ra.refs == {"run_id": ("runs", "mgnify|SRR5676449"),
                       "assembly_id": ("assemblies", "mgnify|ERZ724552")}

    sa = by_table["sample_assemblies"][0]
    assert sa.natural_key == "mgnify|SRS2278353|mgnify|ERZ724552"
    assert sa.refs == {"sample_id": ("samples", "mgnify|SRS2278353"),
                       "assembly_id": ("assemblies", "mgnify|ERZ724552")}


def test_finalize_roundtrip_and_validate():
    reg = Registry()
    for r in emit_assembly("ERZ724552", ASM):
        reg.add(r)
    finalized = reg.finalize()

    asm_row = finalized["assemblies"][0]
    assert asm_row["id"]
    assert asm_row["name"] is None
    asm_id = asm_row["id"]

    assert finalized["run_assemblies"][0]["assembly_id"] == asm_id
    assert finalized["sample_assemblies"][0]["assembly_id"] == asm_id

    report = validate_tables(finalized)
    assert report.hard_errors == []


AN_ASM = {
    "id": "MGYA1",
    "attributes": {"experiment-type": "assembly", "is-private": False,
        "last-update": "2024-01-29T15:29:19.757516", "complete-time": "2019-06-17T00:00:00",
        "mgx-accession": None, "analysis-status": "completed",
        "pipeline-version": "4.1", "instrument-model": "Illumina HiSeq 4000",
        "instrument-platform": "ILLUMINA",
        "analysis-summary": [{"key": "Predicted CDS", "value": "520036"},
                             {"key": "Contigs with predicted RNA", "value": "221"}]},
    "links": {"self": "https://x/analyses/MGYA1"},
    "relationships": {
        "sample": {"data": {"type": "samples", "id": "SRS1"}},
        "assembly": {"data": {"type": "assemblies", "id": "ERZ1"}},
        "study": {"data": {"type": "studies", "id": "MGYS1"}},
        "run": {"data": None},
        "taxonomy": {"links": {"related": "https://x/analyses/MGYA1/taxonomy"}},
        "go-slim": {"links": {"related": "https://x/analyses/MGYA1/go-slim"}},
    }}

EXPECTED_AN_ASM_META = {
    "is_private": False, "last_update": "2024-01-29T15:29:19.757516",
    "mgnify_links": {"self": "https://x/analyses/MGYA1"},
    "complete_time": "2019-06-17T00:00:00", "mgx_accession": None,
    "analysis_status": "completed", "instrument_model": "Illumina HiSeq 4000",
    "pipeline_version": "4.1", "instrument_platform": "ILLUMINA",
    "analysis_result_links": {"taxonomy": "https://x/analyses/MGYA1/taxonomy",
                              "go-slim": "https://x/analyses/MGYA1/go-slim"},
    "relationships_metadata": {"assembly_id": "ERZ1", "assembly_type": "assemblies",
        "study_id": "MGYS1", "study_type": "studies",
        "sample_id": "SRS1", "sample_type": "samples"},
    "analysis_summary": {"Predicted CDS": "520036", "Contigs with predicted RNA": "221"}}

# A RUN analysis: no analysis-summary attribute at all.
AN_RUN = {
    "id": "MGYA2",
    "attributes": {"experiment-type": "metagenomic", "is-private": False,
        "last-update": "2023-03-01T00:00:00", "complete-time": "2023-02-01T00:00:00",
        "mgx-accession": None, "analysis-status": "completed",
        "pipeline-version": "5.0", "instrument-model": "Illumina MiSeq",
        "instrument-platform": "ILLUMINA"},
    "links": {"self": "https://x/analyses/MGYA2"},
    "relationships": {
        "sample": {"data": {"type": "samples", "id": "SRS2"}},
        "assembly": {"data": None},
        "study": {"data": {"type": "studies", "id": "MGYS2"}},
        "run": {"data": {"type": "runs", "id": "SRR2"}},
        "taxonomy": {"links": {"related": "https://x/analyses/MGYA2/taxonomy"}},
    }}


def test_analysis_metadata_assembly_exact():
    assert _analysis_metadata(AN_ASM) == EXPECTED_AN_ASM_META
    rm = _analysis_metadata(AN_ASM)["relationships_metadata"]
    assert "run_id" not in rm
    assert "has_assembly" not in rm


def test_analysis_metadata_run_has_assembly_and_omitted_summary():
    m = _analysis_metadata(AN_RUN)
    rm = m["relationships_metadata"]
    assert rm["run_id"] == "SRR2"
    assert rm["run_type"] == "runs"
    assert rm["has_assembly"] is False
    assert "assembly_id" not in rm
    assert "analysis_summary" not in m


def test_emit_analysis_assembly_records():
    recs = list(emit_analysis("MGYA1", AN_ASM))
    by_table = {}
    for r in recs:
        by_table.setdefault(r.table, []).append(r)

    assert len(by_table["analyses"]) == 1
    assert len(by_table["sample_analyses"]) == 1
    assert len(by_table["assembly_analyses"]) == 1
    assert "run_analyses" not in by_table
    assert len(recs) == 3

    an = by_table["analyses"][0]
    assert an.natural_key == "mgnify|MGYA1"
    assert an.fields["accession"] == "MGYA1"
    assert an.fields["name"] == "MGYA1"
    assert an.fields["analysis_type"] == "assembly"
    assert an.fields["tool_name"] == ""
    assert "external_id" not in an.fields
    assert "data_source_ids" not in an.fields
    assert json.loads(an.fields["metadata"]) == EXPECTED_AN_ASM_META

    sa = by_table["sample_analyses"][0]
    assert sa.natural_key == "mgnify|SRS1|mgnify|MGYA1"
    assert sa.refs == {"sample_id": ("samples", "mgnify|SRS1"),
                       "analysis_id": ("analyses", "mgnify|MGYA1")}

    aa = by_table["assembly_analyses"][0]
    assert aa.natural_key == "mgnify|ERZ1|mgnify|MGYA1"
    assert aa.refs == {"assembly_id": ("assemblies", "mgnify|ERZ1"),
                       "analysis_id": ("analyses", "mgnify|MGYA1")}


def test_emit_analysis_run_records():
    recs = list(emit_analysis("MGYA2", AN_RUN))
    by_table = {}
    for r in recs:
        by_table.setdefault(r.table, []).append(r)

    assert len(by_table["analyses"]) == 1
    assert len(by_table["sample_analyses"]) == 1
    assert len(by_table["run_analyses"]) == 1
    assert "assembly_analyses" not in by_table

    an = by_table["analyses"][0]
    assert an.fields["analysis_type"] == "metagenomic"

    ra = by_table["run_analyses"][0]
    assert ra.natural_key == "mgnify|SRR2|mgnify|MGYA2"
    assert ra.refs == {"run_id": ("runs", "mgnify|SRR2"),
                       "analysis_id": ("analyses", "mgnify|MGYA2")}


def test_finalize_roundtrip_and_validate_analysis():
    reg = Registry()
    for r in emit_analysis("MGYA1", AN_ASM):
        reg.add(r)
    finalized = reg.finalize()

    an_row = finalized["analyses"][0]
    assert an_row["id"]
    an_id = an_row["id"]

    assert finalized["sample_analyses"][0]["analysis_id"] == an_id
    assert finalized["assembly_analyses"][0]["analysis_id"] == an_id

    report = validate_tables(finalized)
    assert report.hard_errors == []


def test_analysis_summary_skips_valueless_and_last_wins():
    obj = {"attributes": {"analysis-summary": [
        {"key": "Predicted CDS", "value": "1"},
        {"key": "Broken"},                       # missing 'value' -> skipped
        {"value": "orphan"},                     # missing 'key'   -> skipped
        {"key": "Predicted CDS", "value": "2"},  # duplicate key   -> last wins
    ]}}
    assert _analysis_summary(obj) == {"Predicted CDS": "2"}


RUN = {
    "id": "SRR10527385",
    "attributes": {"experiment-type": "metagenomic", "is-private": False,
        "accession": "SRR10527385", "secondary-accession": "SRR10527385",
        "ena-study-accession": "SRP233074",
        "instrument-platform": "ILLUMINA", "instrument-model": "Illumina HiSeq 4000"},
    "links": {"self": "https://www.ebi.ac.uk/metagenomics/api/v1/runs/SRR10527385"},
    "relationships": {
        "sample": {"data": {"type": "samples", "id": "SRS5714816"}},
        "study": {"data": {"type": "studies", "id": "MGYS00005495"}},
        "assemblies": {"data": [{"type": "assemblies", "id": "ERZ12633430"}],
                       "links": {"related": "https://x/runs/SRR10527385/assemblies"}},
        "analyses": {"links": {"related": "https://www.ebi.ac.uk/metagenomics/api/v1/runs/SRR10527385/analyses"}},
    }}

EXPECTED_RUN_META = {
    "is_private": False,
    "mgnify_links": {"self": "https://www.ebi.ac.uk/metagenomics/api/v1/runs/SRR10527385"},
    "experiment_type": "metagenomic", "ena_study_accession": "SRP233074",
    "relationships_metadata": {"study_id": "MGYS00005495", "study_type": "studies",
        "sample_id": "SRS5714816", "sample_type": "samples",
        "assembly_ids": ["ERZ12633430"],
        "analyses_link": "https://www.ebi.ac.uk/metagenomics/api/v1/runs/SRR10527385/analyses"}}


def test_run_metadata_exact():
    assert _run_metadata(RUN) == EXPECTED_RUN_META


def test_run_metadata_omits_empty_assembly_ids_and_no_study():
    run2 = {
        "id": "SRR_NOSTUDY",
        "attributes": {"is-private": True, "experiment-type": "metagenomic",
                       "ena-study-accession": None},
        "links": {"self": "https://x/runs/SRR_NOSTUDY"},
        "relationships": {
            "sample": {"data": {"type": "samples", "id": "SRS9"}},
            "study": {"data": None},
            "assemblies": {"data": []},
            "analyses": {"links": {"related": "https://x/runs/SRR_NOSTUDY/analyses"}},
        }}
    rm = _run_metadata(run2)["relationships_metadata"]
    assert "study_id" not in rm
    assert "study_type" not in rm
    assert "assembly_ids" not in rm
    assert rm["sample_id"] == "SRS9"
    assert rm["sample_type"] == "samples"
    assert rm["analyses_link"] == "https://x/runs/SRR_NOSTUDY/analyses"

    run3 = {
        "id": "SRR_ABSENT",
        "attributes": {"is-private": False},
        "relationships": {"sample": {"data": {"type": "samples", "id": "SRS10"}}},
    }
    rm3 = _run_metadata(run3)["relationships_metadata"]
    assert "assembly_ids" not in rm3
    assert "study_id" not in rm3
    assert "analyses_link" not in rm3
    assert rm3["sample_id"] == "SRS10"


def test_emit_run_records():
    recs = list(emit_run("SRR10527385", RUN))
    by_table = {}
    for r in recs:
        by_table.setdefault(r.table, []).append(r)

    assert len(by_table["runs"]) == 1
    assert len(by_table["sample_runs"]) == 1
    assert len(by_table["run_studies"]) == 1
    assert "run_assemblies" not in by_table
    assert len(recs) == 3

    run = by_table["runs"][0]
    assert run.natural_key == "mgnify|SRR10527385"
    assert run.fields["accession"] == "SRR10527385"
    assert run.fields["secondary_accession"] == "SRR10527385"
    assert run.fields["instrument_model"] == "Illumina HiSeq 4000"
    assert run.fields["instrument_platform"] == "ILLUMINA"
    assert "name" not in run.fields
    assert "external_id" not in run.fields
    assert "data_source_ids" not in run.fields
    assert json.loads(run.fields["metadata"]) == EXPECTED_RUN_META

    sr = by_table["sample_runs"][0]
    assert sr.natural_key == "mgnify|SRS5714816|mgnify|SRR10527385"
    assert sr.refs == {"sample_id": ("samples", "mgnify|SRS5714816"),
                       "run_id": ("runs", "mgnify|SRR10527385")}

    rs = by_table["run_studies"][0]
    assert rs.natural_key == "mgnify|SRR10527385|mgnify|MGYS00005495"
    assert rs.refs == {"run_id": ("runs", "mgnify|SRR10527385"),
                       "study_id": ("studies", "mgnify|MGYS00005495")}


def test_emit_run_no_study_no_sample_omits_junctions():
    run_ns = {
        "id": "SRR_NS", "attributes": {"accession": "SRR_NS"},
        "relationships": {"sample": {"data": {"type": "samples", "id": "SRSx"}},
                          "study": {"data": None}}}
    tables_ns = {r.table for r in emit_run("SRR_NS", run_ns)}
    assert "run_studies" not in tables_ns
    assert "sample_runs" in tables_ns

    run_no_samp = {
        "id": "SRR_NSAMP", "attributes": {"accession": "SRR_NSAMP"},
        "relationships": {"study": {"data": {"type": "studies", "id": "MGYSx"}}}}
    tables_no_samp = {r.table for r in emit_run("SRR_NSAMP", run_no_samp)}
    assert "sample_runs" not in tables_no_samp
    assert "run_studies" in tables_no_samp


def test_finalize_roundtrip_and_validate_run():
    reg = Registry()
    for r in emit_run("SRR10527385", RUN):
        reg.add(r)
    finalized = reg.finalize()

    run_row = finalized["runs"][0]
    assert run_row["id"]
    run_id = run_row["id"]

    assert finalized["sample_runs"][0]["run_id"] == run_id
    assert finalized["run_studies"][0]["run_id"] == run_id

    report = validate_tables(finalized)
    assert report.hard_errors == []


# environment-feature/material attrs are null so the sample-metadata fallback applies;
# the country comes from raw_metadata, not geo-loc-name.
SAMPLE = {
    "id": "SRS2278353",
    "attributes": {
        "sample-name": "Activated sludge sample",
        "sample-alias": "AS-01",
        "biosample": "SAMN07666104",
        "last-update": "2024-01-29T15:29:19",
        "analysis-completed": "2018-05-01",
        "collection-date": "2008-10-11",
        "latitude": "55.7", "longitude": "12.5",
        "geo-loc-name": "Denmark",                 # NOT used for geographic_location
        "host-tax-id": "408169", "species": "wastewater metagenome",
        "environment-biome": '"activated sludge biome"',
        "environment-feature": None,               # -> fallback to sample-metadata
        "environment-material": None,              # -> fallback to sample-metadata
        "sample-metadata": [
            {"key": "geographic location (country and/or sea,region)",
             "value": "Denmark: Copenhagen", "unit": None},
            {"key": "environment (feature)",
             "value": 'fecal environmentÊ[ENVO:1]', "unit": None},  # non-ASCII -> space
            {"key": "environment (material)",
             "value": '"sludge, activated"', "unit": None},   # surrounding quotes only
            {"key": "facility", "value": 'Renseanlæg', "unit": None},  # non-ASCII PRESERVED
            {"key": "salinity", "value": '"x, y"', "unit": "PSU"},
        ],
    },
    "links": {"self": "https://www.ebi.ac.uk/metagenomics/api/v1/samples/SRS2278353"},
    "relationships": {
        "biome": {"data": {"type": "biomes", "id": "root:Engineered:Wastewater"}},
        "studies": {"links": {"related": "https://x/samples/SRS2278353/studies"}},
    },
}


def _emit_sample_fields(accession, obj):
    recs = list(emit_sample(accession, obj))
    samp = [r for r in recs if r.table == "samples"]
    assert len(samp) == 1
    return recs, samp[0].fields


def test_emit_sample_columns():
    recs, f = _emit_sample_fields("SRS2278353", SAMPLE)
    assert f["external_id"] == "SRS2278353"
    assert f["accession"] == "SRS2278353"
    assert f["name"] == "Activated sludge sample"
    assert f["sample_alias"] == "AS-01"
    assert f["geographic_location"] == "Denmark: Copenhagen"
    assert f["latitude"] == 55.7 and isinstance(f["latitude"], float)
    assert f["longitude"] == 12.5 and isinstance(f["longitude"], float)
    assert f["collection_date"] == "2008-10-11"
    assert f["host_taxid"] == 408169 and isinstance(f["host_taxid"], int)
    assert f["host_scientific_name"] == "wastewater metagenome"
    assert f["environment_biome"] == "activated sludge biome"
    assert f["environment_feature"] == "fecal environment [ENVO:1]"
    assert f["environment_material"] == "sludge, activated"


def test_emit_sample_collection_date_gating():
    s_missing = json.loads(json.dumps(SAMPLE))
    s_missing["attributes"]["collection-date"] = "missing"
    _, fm = _emit_sample_fields("S_MISS", s_missing)
    assert "collection_date" not in fm

    s_partial = json.loads(json.dumps(SAMPLE))
    s_partial["attributes"]["collection-date"] = "2017"
    _, fp = _emit_sample_fields("S_PART", s_partial)
    assert "collection_date" not in fp

    s_date = json.loads(json.dumps(SAMPLE))
    s_date["attributes"]["collection-date"] = "2008-10-11"
    _, fd = _emit_sample_fields("S_DATE", s_date)
    assert fd["collection_date"] == "2008-10-11"


def test_clean_helper():
    assert _clean('"hello"') == "hello"
    assert _clean('fecalÊenvironment') == "fecal environment"
    assert _clean("  a   b  c  ") == "a b c"
    assert _clean('""') is None
    assert _clean("   ") is None
    assert _clean(None) is None
    assert _clean('"fecal environmentÊ[ENVO:1]"') == "fecal environment [ENVO:1]"


def test_qstrip_helper():
    assert _qstrip('"x, y"') == "x, y"
    assert _qstrip("Renseanlæg") == "Renseanlæg"
    assert _qstrip('"Renseanlæg"') == "Renseanlæg"
    assert _qstrip("a   b") == "a   b"
    assert _qstrip(None) is None
    assert _qstrip(5) == 5


def test_sentinel_helper():
    for s in ("missing", "Not Collected", "N/A", "  none ", "", "NULL"):
        assert _sentinel(s) is None
    assert _sentinel("2008-10-11") == "2008-10-11"
    assert _sentinel(None) is None
    assert _sentinel(5) == 5


def test_sample_metadata_all_keys_and_qstrip():
    s = json.loads(json.dumps(SAMPLE))
    s["attributes"]["biosample"] = None
    s["attributes"]["analysis-completed"] = None
    m = _sample_metadata(s)
    assert set(m.keys()) == {"biosample", "last_update", "raw_metadata", "analysis_completed"}
    assert m["biosample"] is None
    assert m["analysis_completed"] is None
    assert m["last_update"] == "2024-01-29T15:29:19"
    rm = m["raw_metadata"]
    assert rm["salinity"] == {"unit": "PSU", "value": "x, y"}
    assert rm["environment (material)"]["value"] == "sludge, activated"
    assert rm["facility"]["value"] == "Renseanlæg"

def test_sample_metadata_skips_keyless_entries():
    s = {"attributes": {"sample-metadata": [
        {"key": "a", "value": "1"},
        {"value": "orphan"},                # no 'key' -> skipped
        {"key": "b"},                       # no 'value' -> value None
    ]}}
    rm = _raw_metadata(s)
    assert set(rm.keys()) == {"a", "b"}
    assert rm["b"] == {"unit": None, "value": None}


def test_emit_sample_biome_tree_no_study_samples():
    s = json.loads(json.dumps(SAMPLE))
    s["relationships"]["biome"]["data"]["id"] = "root:A:B"
    recs = list(emit_sample("SRS2278353", s))
    by_table = {}
    for r in recs:
        by_table.setdefault(r.table, []).append(r)

    biomes = by_table["biomes"]
    assert len(biomes) == 3
    by_name = {r.natural_key: r for r in biomes}
    assert by_name["root"].fields == {"name": "root", "level": 0}
    assert by_name["root"].refs == {}
    assert by_name["root:A"].fields == {"name": "root:A", "level": 1}
    assert by_name["root:A"].refs == {"parent_id": ("biomes", "root")}
    assert by_name["root:A:B"].fields == {"name": "root:A:B", "level": 2}
    assert by_name["root:A:B"].refs == {"parent_id": ("biomes", "root:A")}

    sb = by_table["sample_biomes"]
    assert len(sb) == 1
    assert sb[0].natural_key == "mgnify|SRS2278353|root:A:B"
    assert sb[0].refs == {"sample_id": ("samples", "mgnify|SRS2278353"),
                          "biome_id": ("biomes", "root:A:B")}

    assert "study_samples" not in by_table


def test_emit_sample_metadata_field_is_json_string():
    _, f = _emit_sample_fields("SRS2278353", SAMPLE)
    meta = json.loads(f["metadata"])
    assert set(meta.keys()) == {"biosample", "last_update", "raw_metadata",
                                "analysis_completed"}
    assert meta["biosample"] == "SAMN07666104"


STUDY = {
    "id": "MGYS00005495",
    "attributes": {
        "study-name": "Activated sludge metagenome study",
        "study-abstract": "An abstract.",
        "bioproject": "PRJNA12345",
        "centre-name": "BGI",
    },
    "links": {"self": "https://www.ebi.ac.uk/metagenomics/api/v1/studies/MGYS00005495"},
    "relationships": {
        "biomes": {"data": [{"type": "biomes", "id": "root:Engineered:Wastewater"}]},
    },
}


def test_emit_study_columns():
    recs = list(emit_study("MGYS00005495", STUDY))
    studies = [r for r in recs if r.table == "studies"]
    assert len(studies) == 1
    st = studies[0]
    assert st.natural_key == "mgnify|MGYS00005495"
    f = st.fields
    assert f["accession"] == "MGYS00005495"
    assert f["study_name"] == "Activated sludge metagenome study"
    assert f["title"] == "Activated sludge metagenome study"
    assert f["abstract"] == "An abstract."
    assert f["bioproject"] == "PRJNA12345"
    assert f["center_name"] == "BGI"
    assert "external_id" not in f
    assert "metadata" not in f
    assert "data_source_ids" not in f
    assert f["biome_ids"] == [str(ids.entity_id("biomes", "root:Engineered:Wastewater"))]
    # study-only biome paths are materialised so biome_ids point at real rows
    biomes = {r.natural_key: r for r in recs if r.table == "biomes"}
    assert set(biomes) == {"root", "root:Engineered", "root:Engineered:Wastewater"}
    assert biomes["root:Engineered:Wastewater"].fields["level"] == 2


def test_emit_study_biome_ids_dedup_and_absent():
    s = json.loads(json.dumps(STUDY))
    s["relationships"]["biomes"]["data"] = [
        {"type": "biomes", "id": "root:A"},
        {"type": "biomes", "id": "root:A"},
        {"type": "biomes", "id": "root:B"},
    ]
    f = list(emit_study("MGYS_DUP", s))[0].fields
    assert f["biome_ids"] == [str(ids.entity_id("biomes", "root:A")),
                             str(ids.entity_id("biomes", "root:B"))]

    s2 = {"id": "MGYS_NB", "attributes": {"study-name": "X"}, "relationships": {}}
    f2 = list(emit_study("MGYS_NB", s2))[0].fields
    assert "biome_ids" not in f2


def test_finalize_roundtrip_and_validate_sample_study():
    reg = Registry()
    for r in emit_sample("SRS2278353", SAMPLE):
        reg.add(r)
    for r in emit_study("MGYS00005495", STUDY):
        reg.add(r)
    finalized = reg.finalize()

    samp_row = finalized["samples"][0]
    assert samp_row["id"]
    samp_id = samp_row["id"]
    study_row = finalized["studies"][0]
    assert study_row["id"]

    assert finalized["sample_biomes"][0]["sample_id"] == samp_id

    report = validate_tables(finalized)
    assert report.hard_errors == []
