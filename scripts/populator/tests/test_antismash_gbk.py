import pathlib
from scripts.populator.adapters.antismash_gbk import parse_region_gbk, parse_region_dir

FIX = pathlib.Path(__file__).parent / "fixtures"


def test_parses_one_region_products_not_cds():
    r = parse_region_gbk((FIX / "region_gbk_one.gbk").read_text(), "CM000741.1", 1)
    assert r.contig == "CM000741.1" and r.region_number == 1
    assert r.start_pos == 0 and r.end_pos == 23535          # 1-based -> 0-based
    assert r.product == ["azole-containing-RiPP"]
    assert r.product_category == ["RiPP"]
    assert "Cysteine desulfurase" not in r.product
    assert r.core_start_pos == 10000 and r.core_end_pos == 13535
    assert r.is_complete is True                             # contig_edge False
    assert r.num_cds_features == 2


def test_edge_and_multi_category():
    r = parse_region_gbk((FIX / "region_gbk_edge.gbk").read_text(), "ctgX", 2)
    assert r.region_number == 2
    assert r.is_complete is False                            # contig_edge True
    assert len(r.product_category) == 2


def test_multiline_qualifier_does_not_spoof_product():
    # A wrapped /rules qualifier has a continuation line starting '/product=spoofed"'.
    r = parse_region_gbk((FIX / "region_gbk_multiline.gbk").read_text(),
                         "CM999999.1", 1)
    assert r.product == ["lassopeptide"]
    assert "spoofed" not in r.product
    assert r.product_category == ["RiPP"]
    assert r.num_cds_features == 2
    assert r.core_start_pos == 4000 and r.core_end_pos == 8000


def test_contig_edge_from_region_feature_only():
    # region /contig_edge="False", protocluster "True": the region feature wins.
    r = parse_region_gbk((FIX / "region_gbk_region_complete.gbk").read_text(),
                         "CM888888.1", 3)
    assert r.is_complete is True
    assert r.region_number == 3


def test_no_region_feature_returns_none():
    r = parse_region_gbk((FIX / "region_gbk_no_region.gbk").read_text(),
                         "CM777777.1", 1)
    assert r is None


def test_happy_path_fixtures_still_return_region():
    assert parse_region_gbk((FIX / "region_gbk_one.gbk").read_text(),
                            "CM000741.1", 1) is not None
    assert parse_region_gbk((FIX / "region_gbk_edge.gbk").read_text(),
                            "ctgX", 2) is not None


def test_parse_region_dir_parses_each_region_file(tmp_path):
    # contig and region number come from the filename, not the GBK body
    one = (FIX / "region_gbk_one.gbk").read_text()
    edge = (FIX / "region_gbk_edge.gbk").read_text()
    (tmp_path / "CM000741.1.region001.gbk").write_text(one)
    (tmp_path / "ctgX.region002.gbk").write_text(edge)
    regions = parse_region_dir(tmp_path)
    assert len(regions) == 2
    by_contig = {r.contig: r for r in regions}
    assert by_contig["CM000741.1"].region_number == 1
    assert by_contig["ctgX"].region_number == 2


def test_parse_region_dir_skips_region_less_file(tmp_path):
    one = (FIX / "region_gbk_one.gbk").read_text()
    no_region = (FIX / "region_gbk_no_region.gbk").read_text()
    (tmp_path / "CM000741.1.region001.gbk").write_text(one)
    (tmp_path / "CM777777.1.region001.gbk").write_text(no_region)
    regions = parse_region_dir(tmp_path)
    assert [r.contig for r in regions] == ["CM000741.1"]


def test_sliced_region_uses_genomic_offset_from_header():
    # A per-region GBK is a slice whose `region 1..23535` is slice-relative; the
    # ##antiSMASH-Data## header carries the genomic position and must win.
    r = parse_region_gbk((FIX / "region_gbk_sliced.gbk").read_text(), "CM000741.1", 1)
    assert r.start_pos == 6436536 and r.end_pos == 6460071
    assert r.end_pos - r.start_pos == 23535
    assert r.core_start_pos == 6436536 + 10000
    assert r.core_end_pos == 6436536 + 13535
    assert r.product == ["azole-containing-RiPP"]
    assert r.num_cds_features == 2


def test_whole_record_gbk_without_header_keeps_feature_locations():
    # Not a slice: no Orig. start/end, locations already absolute.
    r = parse_region_gbk((FIX / "region_gbk_one.gbk").read_text(), "CM000741.1", 1)
    assert r.start_pos == 0 and r.end_pos == 23535
    assert r.core_start_pos == 10000 and r.core_end_pos == 13535


def test_header_span_mismatch_warns_but_trusts_header(caplog):
    # header and region feature disagree: header wins, but it is logged
    text = (FIX / "region_gbk_sliced.gbk").read_text().replace(
        "Orig. end   :: 6460071", "Orig. end   :: 6470071")
    with caplog.at_level("WARNING", logger="populator"):
        r = parse_region_gbk(text, "CM000741.1", 1)
    assert r.start_pos == 6436536 and r.end_pos == 6470071
    assert "disagrees with region feature" in caplog.text
