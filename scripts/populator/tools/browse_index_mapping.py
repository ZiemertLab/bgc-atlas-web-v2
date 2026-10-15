"""OpenSearch mappings for the relational browse indexes.

Strings default to ``keyword`` because the browse APIs substring-match exact
stored values.
"""
from __future__ import annotations

from copy import deepcopy

# tools/ has no __init__.py: tests import it as a namespace package, scripts run
# it directly from this directory.
try:
    from scripts.populator.tools.gcf_dominant_taxon import TAXONOMIC_RANKS
except ImportError:  # pragma: no cover - direct `python tools/...` invocation
    from gcf_dominant_taxon import TAXONOMIC_RANKS

# As lib/gcf/category-share.ts spells them; build_browse_corpus.py selects these.
PRODUCT_CATEGORIES = ("NRPS", "PKS", "RiPP", "terpene", "saccharide", "other")


# Deep `from + size` paging limit per entity. Past OpenSearch's 10,000 default the
# route falls back to SQL OFFSET, which times out on deep pages. The cost is a
# per-request priority queue of `from + size` hits, so bgcs (~16.5M docs, ~0.7GB
# queue) stays at the default and uses seek-based paging instead.
# Sized to about twice the index doc count (not the per-filter totals the pages
# print): a single catalog ingest can add hundreds of thousands of samples, and
# crossing the window fails silently.
ENTITY_MAX_RESULT_WINDOW = {
    "gcfs": 1_250_000,      # ~620k documents
    "samples": 1_750_000,   # ~860k documents
}


COMMON = {
    "settings": {
        "index": {
            "number_of_shards": 1,
            "number_of_replicas": 0,
            "refresh_interval": "30s",
        },
    },
    "mappings": {
        "dynamic_templates": [{
            "strings_as_keywords": {
                "match_mapping_type": "string",
                "mapping": {"type": "keyword", "ignore_above": 8191},
            },
        }],
        "properties": {},
    },
}


ENTITY_PROPERTIES = {
    "bgcs": {
        "bgc_id": {"type": "keyword"},
        "assembly_id": {"type": "keyword"},
        # double, not float: SQL compares Postgres numeric as double precision,
        # so a float would disagree on box edges.
        "latitude": {"type": "double"},
        "longitude": {"type": "double"},
        "gcf_id": {"type": "keyword"},
        "sample_ids": {"type": "keyword"},
        "sample_labels": {"type": "keyword"},
        "data_source_ids": {"type": "keyword"},
        "data_source_names": {"type": "keyword"},
        # Stored under the pre-rename key; the `product` alias is what the app
        # queries, avoiding a reindex of 16.5M docs.
        "product_type": {"type": "keyword"},
        "product": {"type": "alias", "path": "product_type"},
        "product_category": {"type": "keyword"},
        "is_complete": {"type": "boolean"},
        "gc_content": {"type": "float"},
        # BiG-SLICE membership distance at 0.4, lower = better.
        "distance": {"type": "float"},
        "length": {"type": "long"},
        "num_cds_features": {"type": "integer"},
        # Lets GBK exports avoid PostgreSQL lookups (CephFS, ~0.1-0.2 s per cold
        # row). Stored, not indexed, and absent from the browse API.
        "archive_path": {"type": "keyword", "index": False, "doc_values": False},
        # Offset into the combined archive (bgc_gbk_offsets).
        "gbk_offset": {"type": "long", "index": False, "doc_values": False},
        "gbk_length": {"type": "integer", "index": False, "doc_values": False},
        # COALESCE(species, genus, ..., domain), precomputed because OpenSearch
        # cannot sort a COALESCE. Declared explicitly (unlike the dynamic tax_*
        # fields) so a corpus rebuild keeps it.
        "taxonomy_sort": {"type": "keyword"},
    },
    "gcfs": {
        "gcf_id": {"type": "keyword"},
        "study_keys": {"type": "keyword"},
        # study_count = 1 means the family is exclusive to its one study.
        "study_count": {"type": "integer"},
        "representative_bgc_id": {"type": "keyword"},
        "family_class": {"type": "keyword"},   # 'seed' | 'fragmented'
        "listed": {"type": "boolean"},         # false = no page; the index only holds true
        # keyword, not text: the browse search matches it with a wildcard query.
        "pet_name": {"type": "keyword"},
        "member_bgc_count": {"type": "long"},
        "assembly_count": {"type": "long"},
        "complete_bgc_count": {"type": "long"},
        "partial_bgc_count": {"type": "long"},
        "unique_product_categories": {"type": "integer"},
        "unique_taxa_count": {"type": "integer"},
        "seed_assignments": {"type": "long"},
        "derived_assignments": {"type": "long"},
        "novel_assignments": {"type": "long"},
        # Lower = better.
        "avg_distance": {"type": "float"},
        "min_distance": {"type": "float"},
        "max_distance": {"type": "float"},
        "median_distance": {"type": "float"},
        "product_categories": {"type": "keyword"},
        # % of members carrying each category (0-100, overlapping for hybrids),
        # from gcf_distributions_mv so the SQL fallback agrees. Absent when 0.
        # majority_categories (>= 50%) is what free-text search matches;
        # product_categories is the any-member set.
        **{f"category_share_{c.lower()}": {"type": "float"} for c in PRODUCT_CATEGORIES},
        "majority_categories": {"type": "keyword"},
        # In bp. length_est is the median over complete members, or max_len (a
        # floor) when none are complete; precomputed for sorting.
        "median_complete_len": {"type": "integer"},
        "min_len": {"type": "integer"},
        "max_len": {"type": "integer"},
        "length_est": {"type": "integer"},
        # From gcf_distributions_mv so the SQL fallback answers identically.
        "dom_ecosystem_l1": {"type": "keyword"},
        "dom_ecosystem_l3": {"type": "keyword"},
        # resolved_biome_level_1..3 of every member (GOLD and ENVO mixed); not the
        # same vocabulary as biome_distribution_l*.
        "biome_terms": {"type": "keyword"},
        # Every bgcs.product element and domain..species value over primary members.
        "product_terms": {"type": "keyword"},
        "taxonomy_terms": {"type": "keyword"},
        "max_pct_l1": {"type": "float"},
        "max_pct_l2": {"type": "float"},
        "max_pct_l3": {"type": "float"},
        "max_pct_l4": {"type": "float"},
        "max_pct_l5": {"type": "float"},
        # Disabled so arbitrary category keys don't create dynamic fields.
        "biome_distribution_l1": {"type": "object", "enabled": False},
        "biome_distribution_l2": {"type": "object", "enabled": False},
        "biome_distribution_l3": {"type": "object", "enabled": False},
        "biome_distribution_l4": {"type": "object", "enabled": False},
        "biome_distribution_l5": {"type": "object", "enabled": False},
        "product_category_distribution": {"type": "object", "enabled": False},
        "product_type_distribution": {"type": "object", "enabled": False},
        "taxonomy_distribution": {"type": "object", "enabled": False},
        "taxonomy_distributions": {"type": "object", "enabled": False},
        # Dominant non-Unknown taxon per rank and its share of members, so /gcfs
        # can aggregate by taxon (taxonomy_distributions is not aggregatable).
        # The share is indexed so the UI picks the purity cutoff.
        **{f"dom_{rank}": {"type": "keyword"} for rank in TAXONOMIC_RANKS},
        **{f"dom_{rank}_pct": {"type": "float"} for rank in TAXONOMIC_RANKS},
        # MIBiG co-membership (gcf_mibig_anchor), not the KnownClusterBLAST signal
        # in bgc_facets; never add the two.
        "mibig_anchored": {"type": "boolean"},
        "mibig_accessions": {"type": "keyword"},
        "mibig_compounds": {"type": "keyword"},
    },
    "samples": {
        # Absent when the sample has no CheckM values.
        "checkm_tool": {"type": "keyword"},
        "checkm_source": {"type": "keyword"},
        "sample_id": {"type": "keyword"},
        "data_source_ids": {"type": "keyword"},
        "data_source_names": {"type": "keyword"},
        "source_types": {"type": "keyword"},
        "study_titles": {"type": "keyword"},
        # Titles are not unique per study; study_key is
        # COALESCE(NULLIF(study_name,''), accession, id::text), as in study_bgc_summary.
        "study_keys": {"type": "keyword"},
        "latitude": {"type": "float"},
        "longitude": {"type": "float"},
        "host_taxid": {"type": "long"},
        "assembly_count": {"type": "integer"},
        "bgc_count": {"type": "integer"},
        # Clustering-dependent: rebuild after re-clustering. unclustered_bgc_count
        # travels with gcf_count because ~10% of BGCs are in no family.
        "gcf_count": {"type": "integer"},
        "clustered_bgc_count": {"type": "integer"},
        "unclustered_bgc_count": {"type": "integer"},
        "collection_date": {"type": "date", "format": "strict_date_optional_time||yyyy-MM-dd"},
        "collection_date_end": {"type": "date", "format": "strict_date_optional_time||yyyy-MM-dd"},
        # Returned for expanded rows only; disabled to avoid dynamic mapping.
        "metadata": {"type": "object", "enabled": False},
        "gold_ecosystem_metadata": {"type": "object", "enabled": False},
    },
}


def build_mapping(entity: str) -> dict:
    if entity not in ENTITY_PROPERTIES:
        raise ValueError(f"unknown browse entity: {entity}")
    mapping = deepcopy(COMMON)
    mapping["mappings"]["properties"] = deepcopy(ENTITY_PROPERTIES[entity])
    # In the mapping so a rebuilt versioned index keeps it; entities without an
    # entry keep the 10,000 default.
    window = ENTITY_MAX_RESULT_WINDOW.get(entity)
    if window is not None:
        mapping["settings"]["index"]["max_result_window"] = window
    return mapping
