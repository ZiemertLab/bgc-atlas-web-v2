from decimal import Decimal

from scripts.populator.tools.build_browse_corpus import (
    enrich_document,
    BROWSE_INDEX_CONFIGS,
    database_connection_args,
    normalize_document,
)


def test_normalize_document_removes_nulls_and_converts_database_scalars():
    doc = normalize_document({
        "sample_id": "sample-1",
        "latitude": Decimal("41.25"),
        "assembly_count": 2,
        "empty": None,
    })

    assert doc == {
        "sample_id": "sample-1",
        "latitude": 41.25,
        "assembly_count": 2,
    }


def test_each_browse_index_has_a_distinct_document_id_and_query():
    assert BROWSE_INDEX_CONFIGS["bgcs"].id_field == "bgc_id"
    assert BROWSE_INDEX_CONFIGS["gcfs"].id_field == "gcf_id"
    assert BROWSE_INDEX_CONFIGS["samples"].id_field == "sample_id"
    for config in BROWSE_INDEX_CONFIGS.values():
        assert "SELECT" in config.sql
        assert config.id_field in config.sql


def test_sample_corpus_casts_uuid_arrays_to_json_serializable_text_arrays():
    assert "sb.data_source_ids::text[] AS data_source_ids" in BROWSE_INDEX_CONFIGS["samples"].sql


def test_normalize_document_keeps_empty_arrays_for_exact_filter_semantics():
    assert normalize_document({"sample_id": "sample-1", "source_types": []}) == {
        "sample_id": "sample-1",
        "source_types": [],
    }


def test_database_connection_prefers_configured_database_url(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://atlas.example/bgc_atlas_v2")
    assert database_connection_args() == {"dsn": "postgresql://atlas.example/bgc_atlas_v2"}


def test_bgc_documents_keep_one_sample_point_and_drop_the_check_column():
    doc = enrich_document("bgcs", {"bgc_id": "b1", "assembly_id": "a1",
                                   "latitude": 54.5, "longitude": 9.25, "geo_point_count": 1})
    assert doc["latitude"] == 54.5 and doc["longitude"] == 9.25
    assert "geo_point_count" not in doc


def test_bgc_documents_refuse_an_assembly_with_two_points():
    # Scalar fields would index one point of two; SQL matches either.
    import pytest
    with pytest.raises(ValueError, match="distinct sample points"):
        enrich_document("bgcs", {"bgc_id": "b1", "assembly_id": "a1", "geo_point_count": 2})


def test_bgc_corpus_projects_the_run_archive_path():
    sql = BROWSE_INDEX_CONFIGS["bgcs"].sql
    assert "ar.file_path AS archive_path" in sql
    # LEFT: a BGC whose run row is missing must still be indexed, just without a path.
    assert "LEFT JOIN antismash_runs ar ON ar.id = b.antismash_run_id" in sql


def test_bgc_corpus_projects_the_combined_archive_offset():
    sql = BROWSE_INDEX_CONFIGS["bgcs"].sql
    assert "go.gbk_offset, go.gbk_length" in sql
    assert "LEFT JOIN bgc_gbk_offsets go ON go.bgc_id = b.id" in sql
