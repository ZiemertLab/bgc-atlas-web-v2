from scripts.populator.tools.build_facet_index import resolve_run

# Keyed by (contig, region_number): DB region coords are region-relative while the
# JSON's are absolute, so coordinates cannot be the join key.


def test_matched_region_merges_projection_and_bgc_id():
    facets = [{"contig": "c1", "region_number": 1, "start": 12279, "end": 32630,
               "pfam": ["PF1"], "product_type": ["NRPS"]}]
    proj = {("c1", 1): {"bgc_id": "u1", "product_type": ["NRPS-DB"],
                        "length": 20351, "data_source": "x"}}
    docs, stats = resolve_run(facets, proj)
    assert len(docs) == 1
    d = docs[0]
    assert d["bgc_id"] == "u1"
    assert d["pfam"] == ["PF1"]
    assert d["product_type"] == ["NRPS-DB"]   # DB projection wins on overlap
    assert d["data_source"] == "x"
    assert stats == {"matched": 1, "unmatched_regions": 0, "unmatched_bgcs": 0}


def test_matches_despite_coordinate_divergence():
    facets = [{"contig": "c1", "region_number": 1, "start": 12279, "end": 32630}]
    proj = {("c1", 1): {"bgc_id": "u1", "length": 20351}}
    docs, stats = resolve_run(facets, proj)
    assert docs[0]["bgc_id"] == "u1"
    assert stats["matched"] == 1


def test_two_regions_same_contig_distinguished_by_number():
    facets = [
        {"contig": "c1", "region_number": 1},
        {"contig": "c1", "region_number": 2},
    ]
    proj = {("c1", 1): {"bgc_id": "u1"}, ("c1", 2): {"bgc_id": "u2"}}
    docs, stats = resolve_run(facets, proj)
    assert {d["bgc_id"] for d in docs} == {"u1", "u2"}
    assert stats["matched"] == 2


def test_region_without_bgc_row_is_unmatched():
    docs, stats = resolve_run([{"contig": "c2", "region_number": 1}], {})
    assert docs == []
    assert stats["unmatched_regions"] == 1


def test_bgc_row_without_region_is_unmatched():
    docs, stats = resolve_run([], {("c3", 1): {"bgc_id": "u3"}})
    assert docs == []
    assert stats["unmatched_bgcs"] == 1


def test_mixed_counts():
    facets = [
        {"contig": "c1", "region_number": 1},   # matched
        {"contig": "c2", "region_number": 1},   # unmatched region
    ]
    proj = {
        ("c1", 1): {"bgc_id": "u1"},
        ("c3", 1): {"bgc_id": "u3"},            # unmatched bgc
    }
    docs, stats = resolve_run(facets, proj)
    assert stats == {"matched": 1, "unmatched_regions": 1, "unmatched_bgcs": 1}
