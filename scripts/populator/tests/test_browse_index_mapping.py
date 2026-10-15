from scripts.populator.tools.browse_index_mapping import (
    ENTITY_MAX_RESULT_WINDOW,
    build_mapping,
)


def test_gcf_and_sample_indexes_page_past_the_default_result_window():
    """OpenSearch stops at 10,000 by default; past that /gcfs, /genome-collections
    and /samples fall back to a slow deep-OFFSET SQL path. Asserted on the built
    mapping because the live index is rebuilt behind an alias."""
    # Index doc counts, not the per-filter totals the pages print.
    for entity, docs in (("gcfs", 617_926), ("samples", 863_831)):
        window = build_mapping(entity)["settings"]["index"]["max_result_window"]
        assert window == ENTITY_MAX_RESULT_WINDOW[entity]
        # room for the corpus to double; one MAG catalog can add 100k+ samples
        assert window >= docs * 2, (
            f"{entity}: window {window:,} leaves too little headroom over {docs:,}"
        )


def test_bgc_index_keeps_the_default_result_window():
    """`from + size` at 16.5M docs would need ~0.7GB per shard for a last page, so
    bgcs uses a seek-based path instead."""
    assert "bgcs" not in ENTITY_MAX_RESULT_WINDOW
    assert "max_result_window" not in build_mapping("bgcs")["settings"]["index"]


def test_gcf_mapping_uses_gcf_id_and_numeric_sort_fields():
    mapping = build_mapping("gcfs")
    props = mapping["mappings"]["properties"]

    assert props["gcf_id"] == {"type": "keyword"}
    assert props["member_bgc_count"] == {"type": "long"}
    assert props["avg_distance"] == {"type": "float"}
    # v3 family_class + listed replace v2's threshold/family_origin/confident/sepclass.
    assert props["family_class"] == {"type": "keyword"}
    assert props["listed"] == {"type": "boolean"}
    for dropped in ("threshold", "family_origin", "confident", "sepclass"):
        assert dropped not in props
    assert props["seed_assignments"] == {"type": "long"}
    assert props["derived_assignments"] == {"type": "long"}
    assert props["novel_assignments"] == {"type": "long"}
    assert "avg_membership_score" not in props
    assert props["biome_distribution_l1"] == {"type": "object", "enabled": False}
    assert props["taxonomy_distributions"] == {"type": "object", "enabled": False}


def test_gcf_mapping_exposes_an_aggregatable_dominant_taxon_per_rank():
    props = build_mapping("gcfs")["mappings"]["properties"]

    # taxonomy_distributions is enabled:False; these scalars are what /gcfs groups by.
    for rank in ("domain", "phylum", "class", "order", "family", "genus", "species"):
        assert props[f"dom_{rank}"] == {"type": "keyword"}
        assert props[f"dom_{rank}_pct"] == {"type": "float"}


def test_bgc_mapping_carries_the_precomputed_taxonomy_sort_key():
    """/bgcs sorts by COALESCE(species, ..., domain), which OpenSearch cannot sort,
    so the result is carried on the document. Declared explicitly because a
    dynamic-template field would vanish on a corpus rebuild."""
    assert build_mapping("bgcs")["mappings"]["properties"]["taxonomy_sort"] == {"type": "keyword"}


def test_gcf_mapping_carries_the_biome_filter_terms():
    """/gcfs?biome= needs its own terms field; biome_distribution_l1 is enabled:False."""
    props = build_mapping("gcfs")["mappings"]["properties"]
    assert props["biome_terms"] == {"type": "keyword"}


def test_gcf_mapping_carries_the_product_and_taxonomy_filter_terms():
    """The distributions beside these are enabled:False and answer a different question."""
    props = build_mapping("gcfs")["mappings"]["properties"]
    assert props["product_terms"] == {"type": "keyword"}
    assert props["taxonomy_terms"] == {"type": "keyword"}


def test_gcf_mapping_carries_category_shares_of_members():
    """Numeric for range/sort; majority_categories is a keyword for the wildcard search."""
    props = build_mapping("gcfs")["mappings"]["properties"]
    for field in ("category_share_nrps", "category_share_pks", "category_share_ripp",
                  "category_share_terpene", "category_share_saccharide",
                  "category_share_other"):
        assert props[field] == {"type": "float"}
    assert props["majority_categories"] == {"type": "keyword"}
    # still the any-member set: the legacy ?category= text match reads it
    assert props["product_categories"] == {"type": "keyword"}


def test_bgc_mapping_carries_sample_coordinates_as_doubles():
    """double, because SQL compares as double precision; a float could move a point
    across a box edge."""
    props = build_mapping("bgcs")["mappings"]["properties"]
    assert props["latitude"] == {"type": "double"}
    assert props["longitude"] == {"type": "double"}


def test_bgc_mapping_uses_distance_not_membership():
    props = build_mapping("bgcs")["mappings"]["properties"]

    # LOWER distance = better
    assert props["distance"] == {"type": "float"}
    assert "gcf_membership" not in props


def test_sample_mapping_keeps_filter_arrays_as_keywords():
    props = build_mapping("samples")["mappings"]["properties"]

    assert props["sample_id"] == {"type": "keyword"}
    assert props["data_source_ids"] == {"type": "keyword"}
    assert props["source_types"] == {"type": "keyword"}
    assert props["metadata"] == {"type": "object", "enabled": False}
    assert props["gold_ecosystem_metadata"] == {"type": "object", "enabled": False}


def test_mapping_rejects_unknown_entity():
    try:
        build_mapping("unknown")
    except ValueError as error:
        assert "unknown browse entity" in str(error)
    else:
        raise AssertionError("expected unknown entity error")


def test_study_membership_is_mapped_on_the_gcf_index_not_the_bgc_one():
    """Left to dynamic inference, study_keys goes unmapped while every value is empty
    and the /studies/[id] families filter matches nothing."""
    gcf = build_mapping("gcfs")["mappings"]["properties"]
    assert gcf["study_keys"] == {"type": "keyword"}
    assert gcf["study_count"] == {"type": "integer"}

    bgc = build_mapping("bgcs")["mappings"]["properties"]
    assert "study_keys" not in bgc
    assert "study_count" not in bgc

    # /api/samples?studyKey= filters on it
    assert build_mapping("samples")["mappings"]["properties"]["study_keys"] == {"type": "keyword"}


def test_bgc_mapping_stores_the_run_archive_path_without_indexing_it():
    """Read by the GBK exports to skip a PG lookup; not indexed."""
    props = build_mapping("bgcs")["mappings"]["properties"]
    assert props["archive_path"] == {"type": "keyword", "index": False, "doc_values": False}


def test_bgc_mapping_stores_the_combined_archive_offset_without_indexing_it():
    props = build_mapping("bgcs")["mappings"]["properties"]
    assert props["gbk_offset"] == {"type": "long", "index": False, "doc_values": False}
    assert props["gbk_length"] == {"type": "integer", "index": False, "doc_values": False}
