import pathlib
from scripts.populator.adapters.gtdb_metadata import (
    parse_gtdb_lineage, load_gtdb_metadata, parse_lat_lon, load_bac120_sample_meta)

FIX = pathlib.Path(__file__).parent / "fixtures" / "gtdb_hq_small.tsv"

FULL = ("d__Bacteria;p__Bacillota;c__Bacilli;o__Bacillales;"
        "f__Bacillaceae;g__Bacillus;s__Bacillus subtilis")
PARTIAL = ("d__Bacteria;p__Desulfobacterota_D;c__UBA1144;o__UBA2774;"
           "f__CSP1-2;g__;s__")


def test_parse_full_lineage_seven_ranks():
    f = parse_gtdb_lineage(FULL)
    # rank columns store the full prefixed value (live DB/app contract)
    assert f["domain"] == "d__Bacteria"
    assert f["phylum"] == "p__Bacillota"
    assert f["class"] == "c__Bacilli"
    assert f["order_name"] == "o__Bacillales"
    assert f["family"] == "f__Bacillaceae"
    assert f["genus"] == "g__Bacillus"
    assert f["species"] == "s__Bacillus subtilis"
    assert f["rank_depth"] == 7
    assert f["is_partial"] is False
    assert f["source"] == "gtdb"
    assert f["gtdb_lineage"] == FULL


def test_parse_partial_lineage_skips_empty_ranks():
    f = parse_gtdb_lineage(PARTIAL)
    assert f["domain"] == "d__Bacteria"
    assert f["family"] == "f__CSP1-2"
    assert "genus" not in f
    assert "species" not in f
    assert f["rank_depth"] == 5
    assert f["is_partial"] is True
    assert f["gtdb_lineage"] == (
        "d__Bacteria;p__Desulfobacterota_D;c__UBA1144;o__UBA2774;f__CSP1-2")
    assert f["source"] == "gtdb"


def test_load_metadata_maps_accession_to_source_and_lineage():
    meta = load_gtdb_metadata(FIX)
    st, lin = meta.get("GB_GCA_000003955.1")
    assert st == "isolate"
    assert lin == FULL


def test_load_metadata_preserves_mag_and_sag():
    meta = load_gtdb_metadata(FIX)
    assert meta.get("GB_GCA_111111111.1")[0] == "MAG"
    assert meta.get("GB_GCA_222222222.1")[0] == "SAG"


def test_load_metadata_unknown_accession_returns_none():
    meta = load_gtdb_metadata(FIX)
    assert meta.get("GB_GCA_999999999.9") is None


def test_unknown_category_defaults_to_isolate(tmp_path):
    p = tmp_path / "small.tsv"
    p.write_text(
        "Representative genome\tGenome category\tGTDB taxonomy\n"
        "GB_X.1\tunclassified\td__Bacteria\n")
    meta = load_gtdb_metadata(p)
    assert meta.get("GB_X.1")[0] == "isolate"


def test_parse_lat_lon_cardinal_directions_set_sign():
    assert parse_lat_lon("32.24 N 119.26 E") == (32.24, 119.26)
    assert parse_lat_lon("39.2833 N 76.6167 W") == (39.2833, -76.6167)   # W -> negative lon
    assert parse_lat_lon("23.33 S 46.37 W") == (-23.33, -46.37)          # S/W -> both negative


def test_parse_lat_lon_other_formats_and_failures():
    assert parse_lat_lon("12.3, 45.6") == (12.3, 45.6)     # comma-separated, no cardinal
    assert parse_lat_lon("12.3 45.6") == (12.3, 45.6)      # space-separated, no cardinal
    assert parse_lat_lon("12.3N 45.6E") == (12.3, 45.6)    # glued cardinal (2-part, embedded)
    assert parse_lat_lon("S12.3 W45.6") == (-12.3, -45.6)  # glued cardinal, both negative
    assert parse_lat_lon("none") == (None, None)
    assert parse_lat_lon("") == (None, None)
    assert parse_lat_lon(None) == (None, None)
    assert parse_lat_lon("200 N 300 E") == (None, None)    # out of range -> rejected
    assert parse_lat_lon("garbage") == (None, None)
    assert parse_lat_lon("45 N") == (None, None)           # only one component


def _sidecar(tmp_path):
    p = tmp_path / "sidecar.tsv"
    cols = ["accession", "ncbi_organism_name", "ncbi_isolation_source", "ncbi_lat_lon",
            "ncbi_country", "gtdb_taxonomy", "gtdb_representative", "ncbi_taxonomy",
            "ncbi_taxid", "ncbi_species_taxid", "ncbi_bioproject", "ncbi_submitter",
            "ncbi_genome_representation"]
    rows = [
        ["RS_GCF_1.1", "Escherichia coli", "gut", "32.24 N 119.26 E", "China",
         "d__Bacteria", "t", "d__Bacteria", "562", "562", "PRJNA1", "JGI", "full"],
        # genome 2: no lat_lon, no country, only organism -> metadata only
        ["GB_GCA_2.1", "Bacillus sp.", "none", "none", "none",
         "d__Bacteria;p__Bacillota", "f", "none", "1", "1", "none", "EMBL", "full"],
        # genome 3: everything "none"/empty -> omitted entirely
        ["GB_GCA_3.1", "none", "none", "none", "none", "none", "none", "none",
         "none", "none", "none", "none", "none"],
    ]
    p.write_text("\t".join(cols) + "\n" + "\n".join("\t".join(r) for r in rows) + "\n")
    return str(p)


def test_load_bac120_sample_meta(tmp_path):
    import json
    m = load_bac120_sample_meta(_sidecar(tmp_path))
    # genome 3 (all none) is omitted
    assert set(m) == {"RS_GCF_1.1", "GB_GCA_2.1"}
    g1 = m["RS_GCF_1.1"]
    assert g1["latitude"] == 32.24 and g1["longitude"] == 119.26
    assert g1["geographic_location"] == "China"
    md1 = json.loads(g1["metadata"])
    assert md1["ncbi_organism_name"] == "Escherichia coli"
    assert md1["ncbi_isolation_source"] == "gut"
    assert md1["gtdb_representative"] == "True"             # bac120 't' -> 'True'
    assert json.loads(m["GB_GCA_2.1"]["metadata"])["gtdb_representative"] == "False"   # 'f'
    # genome 2: no lat/lon, no geo; metadata skips the "none" keys (isolation, ncbi_taxonomy, bioproject)
    g2 = m["GB_GCA_2.1"]
    assert "latitude" not in g2 and "geographic_location" not in g2
    md2 = json.loads(g2["metadata"])
    assert md2["ncbi_organism_name"] == "Bacillus sp."
    assert "ncbi_isolation_source" not in md2
    assert "ncbi_taxonomy" not in md2
    assert "ncbi_bioproject" not in md2
