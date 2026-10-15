from scripts.populator.tools.backfill_gtdb_geo import geo_fields


def test_country_and_lat_lon():
    f = geo_fields("China: Jiangsu; Nanjing", "31.59 N 118.43 E")
    assert f["geographic_location"] == "China: Jiangsu; Nanjing"
    assert round(f["latitude"], 2) == 31.59
    assert round(f["longitude"], 2) == 118.43


def test_country_only():
    f = geo_fields("Germany", "none")
    assert f == {"geographic_location": "Germany"}


def test_lat_lon_only():
    f = geo_fields("none", "12.3 S 45.6 W")
    assert "geographic_location" not in f
    assert round(f["latitude"], 1) == -12.3
    assert round(f["longitude"], 1) == -45.6


def test_both_none_yields_empty():
    assert geo_fields("none", "none") == {}
    assert geo_fields("", "") == {}


def test_unparseable_lat_lon_dropped_country_kept():
    f = geo_fields("Spain", "not a coordinate")
    assert f == {"geographic_location": "Spain"}
