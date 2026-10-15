import pytest

from scripts.populator import schema

def test_bgcs_required_columns_present():
    cols = schema.TABLES["bgcs"].columns
    for c in ("id", "filename", "assembly", "analysis_id", "antismash_run_id",
              "contig", "start_pos", "end_pos", "product_category", "product",
              "anchor", "is_complete", "num_cds_features"):
        assert c in cols

def test_bgcs_carries_no_derived_per_bgc_columns():
    """load.py builds `\\copy bgcs (<columns>)` verbatim, so a column the DB lacks fails
    every bgcs load."""
    cols = schema.TABLES["bgcs"].columns
    for c in ("gcf_id", "gcf_membership", "taxonomy_id"):
        assert c not in cols
        assert c not in schema.TABLES["bgcs"].fks

def test_fk_graph_is_declared():
    assert schema.TABLES["bgcs"].fks["assembly"] == "assemblies"
    assert schema.TABLES["bgcs"].fks["analysis_id"] == "analyses"

def test_load_order_is_fk_safe():
    order = schema.load_order()
    assert order.index("assemblies") < order.index("bgcs")
    assert order.index("data_sources") < order.index("samples")

def test_load_order_raises_on_cycle(monkeypatch):
    from scripts.populator import schema
    cyclic = {
        "A": schema.Table("A", ["id"], ["id"], fks={"b_id": "B"}),
        "B": schema.Table("B", ["id"], ["id"], fks={"a_id": "A"}),
    }
    monkeypatch.setattr(schema, "TABLES", cyclic)
    with pytest.raises(ValueError):
        schema.load_order()

def test_table_is_immutable():
    t = schema.TABLES["bgcs"]
    assert isinstance(t.columns, tuple)
    assert isinstance(t.natural_key_cols, tuple)
    with pytest.raises(TypeError):
        t.fks["x"] = "y"            # MappingProxyType is read-only

def test_samples_has_env_columns():
    cols = schema.TABLES["samples"].columns
    for c in ("latitude", "longitude", "environment_biome", "depth",
              "depth_min_meters", "depth_max_meters", "ph",
              "temperature", "sample_alias", "collection_date"):
        assert c in cols

def test_studies_biomes_and_junctions_declared():
    for t in ("studies", "biomes", "study_samples", "sample_biomes"):
        assert t in schema.TABLES
    assert schema.TABLES["sample_biomes"].fks["biome_id"] == "biomes"
    assert schema.TABLES["study_samples"].fks["study_id"] == "studies"

def test_studies_has_study_type_and_secondary_accession():
    cols = schema.TABLES["studies"].columns
    assert "study_type" in cols
    assert "secondary_accession" in cols

def test_biomes_tree_columns_and_self_fk():
    b = schema.TABLES["biomes"]
    assert "parent_id" in b.columns
    assert "level" in b.columns
    assert b.fks["parent_id"] == "biomes"   # self-referential tree

def test_load_order_tolerates_self_fk():
    order = schema.load_order()
    assert "biomes" in order

def test_load_order_still_raises_on_real_cycle(monkeypatch):
    # the self-FK skip must not weaken genuine 2-table cycle detection
    cyclic = {
        "A": schema.Table("A", ["id"], ["id"], fks={"b_id": "B"}),
        "B": schema.Table("B", ["id"], ["id"], fks={"a_id": "A"}),
    }
    monkeypatch.setattr(schema, "TABLES", cyclic)
    with pytest.raises(ValueError):
        schema.load_order()

def test_samples_has_host_columns():
    cols = schema.TABLES["samples"].columns
    assert "host_taxid" in cols and "host_scientific_name" in cols

def test_taxonomies_declared_with_lineage_nk():
    t = schema.TABLES["taxonomies"]
    assert t.natural_key_cols == ("gtdb_lineage",)
    for c in ("gtdb_lineage", "domain", "phylum", "class", "order_name",
              "family", "genus", "species", "source", "is_partial", "rank_depth"):
        assert c in t.columns

def test_bgc_taxonomy_declared_with_bgc_nk():
    t = schema.TABLES["bgc_taxonomy"]
    assert t.natural_key_cols == ("bgc_id",)
    assert t.fks == {"bgc_id": "bgcs", "taxonomy_id": "taxonomies"}
    for c in ("bgc_id", "taxonomy_id", "rank", "support", "method"):
        assert c in t.columns
    assert "taxonomy_id" not in schema.TABLES["bgcs"].columns

def test_load_order_puts_bgc_taxonomy_after_both_parents():
    order = schema.load_order()
    assert order.index("bgcs") < order.index("bgc_taxonomy")
    assert order.index("taxonomies") < order.index("bgc_taxonomy")

def test_none_defaults_declared():
    from scripts.populator import schema
    assert schema.TABLES["samples"].none_defaults["metadata"] == "{}"
    assert schema.TABLES["bgcs"].none_defaults["product"] == "{}"
    assert dict(schema.TABLES["taxonomies"].none_defaults) == {}


def test_populator_does_not_own_gcfs():
    """A populator `gcfs` row would insert NULL clustering columns into the
    authoritative table; GCFs are assigned corpus-wide by clustering."""
    assert "gcfs" not in schema.TABLES
    assert "bgc_gcf" not in schema.TABLES
