import json, pathlib
from scripts.populator.adapters.antismash_json import parse_regions

FIX = pathlib.Path(__file__).parent / "fixtures"

def _load(name):
    return json.loads((FIX / name).read_text())

def test_one_region():
    regions = list(parse_regions(_load("as_one_region.json")))
    assert len(regions) == 1
    r = regions[0]
    assert r.contig == "FRAM_RAS_F4_03_1819_1-c000000000021"
    assert r.region_number == 1
    assert r.start_pos == 0 and r.end_pos == 6443
    assert r.product == ["hydrogen-cyanide"]
    assert r.product_category == ["other"]
    assert r.core_start_pos == 926 and r.core_end_pos == 3758
    assert r.is_complete is False          # contig_edge == True
    assert r.num_cds_features == 6
    assert r.taxon == "bacteria"

def test_two_region_numbering_and_completeness():
    regions = list(parse_regions(_load("as_two_region.json")))
    assert len(regions) == 3
    by_key = {(r.contig, r.region_number): r for r in regions}
    a1 = by_key[("contigA", 1)]
    a2 = by_key[("contigA", 2)]
    b1 = by_key[("contigB", 1)]
    assert a1.start_pos == 0 and a1.end_pos == 5000
    assert a1.is_complete is False and a1.num_cds_features == 1   # only [100:900]
    assert a2.is_complete is True and a2.num_cds_features == 2    # [8200:9000],[9100:10000]
    assert a2.product_category == ["PKS"] and a2.product == ["T1PKS"]
    assert b1.is_complete is True and b1.product_category == ["terpene"]

def test_empty_records():
    assert list(parse_regions({"records": []})) == []

def test_fuzzy_location_bounds():
    data = {"taxon": "bacteria", "records": [{
        "id": "c1",
        "areas": [{"start": 0, "end": 100, "products": ["x"], "protoclusters": {}}],
        "features": [{"type": "region", "location": "[<0:>100](+)",
                      "qualifiers": {"region_number": ["1"], "contig_edge": ["False"]}}]
    }]}
    regions = list(parse_regions(data))
    assert len(regions) == 1 and regions[0].region_number == 1

def test_missing_region_feature_warns(caplog):
    import logging
    data = {"taxon": "bacteria", "records": [{
        "id": "c1",
        "areas": [{"start": 0, "end": 100, "products": ["x"], "protoclusters": {}}],
        "features": []   # no region feature to match the area
    }]}
    with caplog.at_level(logging.WARNING):
        regions = list(parse_regions(data))
    assert len(regions) == 1
    assert regions[0].region_number == 1 and regions[0].is_complete is True
    assert any("no matching region feature" in rec.message for rec in caplog.records)
