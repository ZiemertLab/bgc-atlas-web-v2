"""Tests for the native-v2 MGnify new-type emitters (publications, super-studies,
genome-catalogues, genomes) and their schema/load_order declaration."""
import json

from scripts.populator.adapters.mgnify_v2_newtypes import (
    emit_publication, emit_super_study, emit_genome_catalogue, emit_genome,
)
from scripts.populator import schema
from scripts.populator.ids import scoped


PUBLICATION = {
    "pubmed_id": 31696230,
    "title": "MGnify: the microbiome analysis resource in 2020",
    "published_year": 2020,
    "metadata": {"doi": "10.1093/nar/gkz1035", "isbn": None},
}

SUPER_STUDY = {
    "slug": "atlanteco",
    "title": "AtlantECO",
    "description": "An Atlantic-ocean meta-omics super study.",
    "logo_url": "https://example.org/atlanteco.png",
    "flagship_studies": ["MGYS00006028"],
    "related_studies": ["MGYS00006029", "MGYS00006030"],
    "genome_catalogues": ["marine-v2-0"],
}

CATALOGUE = {
    "catalogue_id": "soil-v1-0",
    "name": "Soil v1.0",
    "version": "1.0",
    "description": "Soil metagenome-assembled genomes.",
    "biome": {"lineage": "root:Environmental:Terrestrial:Soil"},
    "genome_count": 8000,
    "unclustered_genome_count": 12000,
    "ftp_url": "https://ftp.example.org/soil-v1-0",
    "result_directory": "/results/soil-v1-0",
    "pipeline_version_tag": "v1.2.1",
    "catalogue_biome_label": "Soil",
    "catalogue_type": "mag",
    "updated_at": "2026-04-30T12:00:00Z",
    "other_stats": {"avg_completeness": 92.0},
    "downloads": [{"label": "metadata", "url": "https://x/y"}],
    "protein_catalogue_name": "soil-protein-v1-0",
    "protein_catalogue_description": "Soil protein catalogue.",
}

GENOME = {
    "accession": "MGYG000490811",
    "catalogue_id": "soil-v1-0",
    "ena_genome_accession": "GCA_900540811",
    "ena_sample_accession": "ERS1234567",
    "ena_study_accession": "ERP123456",
    "ncbi_genome_accession": "GCF_900540811",
    "img_genome_accession": None,
    "length": 4887314,
    "num_contigs": 142,
    "n_50": 65000,
    "gc_content": 61.4,
    "type": "MAG",
    "completeness": 88.19,
    "contamination": 1.2,
    "taxon_lineage": "d__Bacteria;p__Pseudomonadota;c__Gammaproteobacteria",
    "geographic_origin": "Europe",
    "biome": {"lineage": "root:Environmental:Terrestrial:Soil"},
    "updated_at": "2026-04-30T12:00:00Z",
    "geographic_range": ["Europe", "Asia"],
    "num_genomes_total": 3,
    "patric_genome_accession": None,
}


def _one(records):
    recs = list(records)
    assert len(recs) == 1
    return recs[0]


def test_emit_publication_record():
    r = _one(emit_publication(PUBLICATION))
    assert r.table == "mgnify_publications"
    assert r.natural_key == scoped("mgnify", "31696230")
    assert r.fields["pubmed_id"] == "31696230"
    assert r.fields["title"] == "MGnify: the microbiome analysis resource in 2020"
    assert r.fields["published_year"] == 2020
    meta = json.loads(r.fields["metadata"])
    assert meta["doi"] == "10.1093/nar/gkz1035"


def test_emit_publication_missing_pubmed_id_emits_nothing():
    assert list(emit_publication({"title": "no id"})) == []


def test_emit_publication_year_coercion_from_string():
    r = _one(emit_publication({"pubmed_id": 1, "published_year": "2020"}))
    assert r.fields["published_year"] == 2020


def test_emit_super_study_record():
    r = _one(emit_super_study(SUPER_STUDY))
    assert r.table == "mgnify_super_studies"
    assert r.natural_key == scoped("mgnify", "atlanteco")
    assert r.fields["slug"] == "atlanteco"
    assert r.fields["title"] == "AtlantECO"
    assert r.fields["logo_url"] == "https://example.org/atlanteco.png"
    meta = json.loads(r.fields["metadata"])
    assert meta["flagship_studies"] == ["MGYS00006028"]
    assert meta["related_studies"] == ["MGYS00006029", "MGYS00006030"]
    assert meta["genome_catalogues"] == ["marine-v2-0"]


def test_emit_super_study_missing_slug_emits_nothing():
    assert list(emit_super_study({"title": "no slug"})) == []


def test_emit_genome_catalogue_record():
    r = _one(emit_genome_catalogue(CATALOGUE))
    assert r.table == "mgnify_genome_catalogues"
    assert r.natural_key == scoped("mgnify", "soil-v1-0")
    assert r.fields["catalogue_id"] == "soil-v1-0"
    assert r.fields["name"] == "Soil v1.0"
    assert r.fields["version"] == "1.0"
    assert r.fields["biome_lineage"] == "root:Environmental:Terrestrial:Soil"
    assert r.fields["genome_count"] == 8000
    assert r.fields["unclustered_genome_count"] == 12000
    assert r.fields["ftp_url"] == "https://ftp.example.org/soil-v1-0"
    assert r.fields["pipeline_version_tag"] == "v1.2.1"
    assert r.fields["catalogue_type"] == "mag"
    meta = json.loads(r.fields["metadata"])
    assert meta["protein_catalogue_name"] == "soil-protein-v1-0"
    assert meta["other_stats"] == {"avg_completeness": 92.0}
    assert "downloads" in meta


def test_emit_genome_catalogue_missing_id_emits_nothing():
    assert list(emit_genome_catalogue({"name": "no id"})) == []


def test_emit_genome_catalogue_biome_lineage_missing_is_omitted():
    r = _one(emit_genome_catalogue({"catalogue_id": "x"}))
    assert "biome_lineage" not in r.fields


def test_emit_genome_record_and_fk():
    r = _one(emit_genome(GENOME))
    assert r.table == "mgnify_genomes"
    assert r.natural_key == scoped("mgnify", "MGYG000490811")
    assert r.fields["accession"] == "MGYG000490811"
    assert r.fields["length"] == 4887314
    assert r.fields["num_contigs"] == 142
    assert r.fields["n_50"] == 65000
    assert r.fields["gc_content"] == 61.4
    assert r.fields["completeness"] == 88.19
    assert r.fields["contamination"] == 1.2
    assert r.fields["type"] == "MAG"
    assert r.fields["taxon_lineage"].startswith("d__Bacteria")
    assert r.fields["geographic_origin"] == "Europe"
    assert r.fields["biome_lineage"] == "root:Environmental:Terrestrial:Soil"
    assert r.refs["genome_catalogue_id"] == (
        "mgnify_genome_catalogues", scoped("mgnify", "soil-v1-0"))
    meta = json.loads(r.fields["metadata"])
    assert meta["geographic_range"] == ["Europe", "Asia"]
    assert meta["num_genomes_total"] == 3


def test_emit_genome_missing_accession_emits_nothing():
    assert list(emit_genome({"catalogue_id": "soil-v1-0"})) == []


def test_emit_genome_length_string_coerced_to_int():
    r = _one(emit_genome({"accession": "MGYG1", "length": "4887314"}))
    assert r.fields["length"] == 4887314
    assert isinstance(r.fields["length"], int)


def test_emit_genome_no_catalogue_id_omits_fk():
    r = _one(emit_genome({"accession": "MGYG1"}))
    assert "genome_catalogue_id" not in r.refs


def test_emit_genome_metadata_is_valid_json():
    r = _one(emit_genome(GENOME))
    meta = json.loads(r.fields["metadata"])
    for k in ("geographic_range", "num_genomes_total", "patric_genome_accession"):
        assert k in meta


def test_new_type_tables_declared():
    for t in ("mgnify_publications", "mgnify_super_studies",
              "mgnify_genome_catalogues", "mgnify_genomes"):
        assert t in schema.TABLES


def test_genome_catalogue_fk_declared():
    assert schema.TABLES["mgnify_genomes"].fks["genome_catalogue_id"] == \
        "mgnify_genome_catalogues"


def test_load_order_catalogues_before_genomes():
    order = schema.load_order()
    assert order.index("mgnify_genome_catalogues") < order.index("mgnify_genomes")


def test_load_order_contains_each_table_once():
    order = schema.load_order()
    assert sorted(order) == sorted(schema.TABLES.keys())
    assert len(order) == len(set(order))


def test_new_type_none_defaults_metadata():
    for t in ("mgnify_publications", "mgnify_super_studies",
              "mgnify_genome_catalogues", "mgnify_genomes"):
        assert schema.TABLES[t].none_defaults["metadata"] == "{}"
