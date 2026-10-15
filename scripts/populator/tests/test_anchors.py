import io
import tarfile

from scripts.populator.adapters.anchors import parse_regions_js, region_anchor_map

REGIONS_JS = (
    'var recordData = [\n'
    ' {"length": 100, "seq_id": "k141_54900", "regions": [{"idx": 1, "anchor": "r1c1"}]},\n'
    ' {"length": 200, "seq_id": "NODE_7", "regions": [{"idx": 1, "anchor": "r2c1"}, {"idx": 2, "anchor": "r2c2"}]}\n'
    '];\n'
    'var resultsData = {};\n'
)


def test_parse_regions_js_maps_contig_region_to_anchor():
    m = parse_regions_js(REGIONS_JS)
    assert m[("k141_54900", 1)] == "r1c1"
    assert m[("NODE_7", 1)] == "r2c1"
    assert m[("NODE_7", 2)] == "r2c2"


def test_parse_regions_js_empty_on_garbage():
    assert parse_regions_js("no record data here") == {}


def test_parse_regions_js_ignores_embedded_bracket_semicolon_in_string():
    """A '];' inside a string must not truncate the array."""
    text = (
        'var recordData = [\n'
        ' {"seq_id": "c1", "desc": "note with ]; inside it", '
        '"regions": [{"idx": 1, "anchor": "r1c1"}]},\n'
        ' {"seq_id": "c2", "regions": [{"idx": 1, "anchor": "r2c1"}]}\n'
        '];\n'
        'var resultsData = {"deep": [[1], [2]]};\n'
    )
    m = parse_regions_js(text)
    assert m[("c1", 1)] == "r1c1"
    assert m[("c2", 1)] == "r2c1"


def test_parse_regions_js_isolate_sparse_anchor_and_empty_regions():
    text = (
        'var recordData = [\n'
        ' {"seq_id": "no_bgc", "regions": []},\n'
        ' {"seq_id": "NZ_x", "regions": [{"idx": 1, "anchor": "r7c1"}]}\n'
        '];\n'
    )
    m = parse_regions_js(text)
    assert ("no_bgc", 1) not in m
    assert m[("NZ_x", 1)] == "r7c1"


def test_parse_regions_js_empty_array():
    assert parse_regions_js("var recordData = [];") == {}


def test_parse_regions_js_region_missing_anchor_is_skipped():
    text = 'var recordData = [{"seq_id": "c1", "regions": [{"idx": 1}]}];'
    assert parse_regions_js(text) == {}


def test_parse_regions_js_non_list_recorddata():
    assert parse_regions_js('var recordData = {"seq_id": "c1"};') == {}


def test_parse_regions_js_scalar_items_do_not_crash():
    assert parse_regions_js("var recordData = [1, 2, 3];") == {}


def test_parse_regions_js_non_numeric_idx_is_skipped():
    text = 'var recordData = [{"seq_id": "c1", "regions": [{"idx": "x", "anchor": "r1c1"}]}];'
    assert parse_regions_js(text) == {}


def test_parse_regions_js_word_boundary():
    assert parse_regions_js('var myrecordData = [{"seq_id": "c1", '
                            '"regions": [{"idx": 1, "anchor": "r1c1"}]}];') == {}


def _make_targz(members: dict) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as t:
        for name, text in members.items():
            data = text.encode("utf-8")
            info = tarfile.TarInfo(name=name)
            info.size = len(data)
            t.addfile(info, io.BytesIO(data))
    return buf.getvalue()


def test_region_anchor_map_reads_nested_regions_js(tmp_path):
    p = tmp_path / "run.tar.gz"
    p.write_bytes(_make_targz({
        "run/run/some_other.txt": "irrelevant",
        "run/run/regions.js": REGIONS_JS,
    }))
    m = region_anchor_map(str(p))
    assert m[("k141_54900", 1)] == "r1c1"
    assert m[("NODE_7", 2)] == "r2c2"


def test_region_anchor_map_missing_path_returns_empty(tmp_path):
    assert region_anchor_map(str(tmp_path / "does_not_exist.tar.gz")) == {}


def test_region_anchor_map_no_regions_js_returns_empty(tmp_path):
    p = tmp_path / "run.tar.gz"
    p.write_bytes(_make_targz({"run/run/other.txt": "nothing here"}))
    assert region_anchor_map(str(p)) == {}


def test_region_anchor_map_garbage_bytes_returns_empty(tmp_path):
    p = tmp_path / "garbage.tar.gz"
    p.write_bytes(b"this is not a tar archive at all")
    assert region_anchor_map(str(p)) == {}


# Converted MGnify tarballs carry `<name>_basic/` (prescreen, whole-assembly record
# numbering) and `<name>/` (full run, renumbered). The site serves `<name>/`, so its
# anchors must win regardless of archive order.

BASIC_JS = (
    'var recordData = [\n'
    ' {"seq_id": "NODE_7", "regions": [{"idx": 1, "anchor": "r89c1"}]}\n'
    '];\n'
)
FULL_JS = (
    'var recordData = [\n'
    ' {"seq_id": "NODE_7", "regions": [{"idx": 1, "anchor": "r7c1"}]}\n'
    '];\n'
)


def test_select_regions_js_prefers_non_basic_when_basic_is_first():
    from scripts.populator.adapters.anchors import select_regions_js
    assert select_regions_js([
        "./run/run_basic/regions.js",
        "./run/run/regions.js",
    ]) == "./run/run/regions.js"


def test_select_regions_js_prefers_non_basic_when_basic_is_second():
    from scripts.populator.adapters.anchors import select_regions_js
    assert select_regions_js([
        "./run/run/regions.js",
        "./run/run_basic/regions.js",
    ]) == "./run/run/regions.js"


def test_select_regions_js_falls_back_to_basic_when_it_is_the_only_one():
    """A run whose full pass failed keeps working rather than losing anchors."""
    from scripts.populator.adapters.anchors import select_regions_js
    assert select_regions_js(["./run/run_basic/regions.js"]) == "./run/run_basic/regions.js"


def test_select_regions_js_none_when_no_candidates():
    from scripts.populator.adapters.anchors import select_regions_js
    assert select_regions_js([]) is None


def test_select_regions_js_tie_break_is_deterministic():
    """Two non-basic candidates: shortest path, then lexicographic, never tar order."""
    from scripts.populator.adapters.anchors import select_regions_js
    names = ["./run/b/deeper/regions.js", "./run/a/regions.js", "./run/b/regions.js"]
    assert select_regions_js(names) == "./run/a/regions.js"
    assert select_regions_js(list(reversed(names))) == "./run/a/regions.js"


def test_select_regions_js_only_exact_basic_suffix_is_depreferred():
    """Only a parent whose name ends in `_basic` is the prescreen directory."""
    from scripts.populator.adapters.anchors import select_regions_js
    assert select_regions_js(["./run/run_basics/regions.js"]) == "./run/run_basics/regions.js"


def test_region_anchor_map_dual_viewer_uses_the_full_run(tmp_path):
    """The _basic member is stored first and must lose."""
    p = tmp_path / "run.tar.gz"
    p.write_bytes(_make_targz({
        "./run/run_basic/regions.js": BASIC_JS,
        "./run/run/regions.js": FULL_JS,
    }))
    assert region_anchor_map(str(p))[("NODE_7", 1)] == "r7c1"


def test_region_anchor_map_dual_viewer_order_does_not_matter(tmp_path):
    p = tmp_path / "run.tar.gz"
    p.write_bytes(_make_targz({
        "./run/run/regions.js": FULL_JS,
        "./run/run_basic/regions.js": BASIC_JS,
    }))
    assert region_anchor_map(str(p))[("NODE_7", 1)] == "r7c1"


def test_region_anchor_map_basic_only_still_yields_anchors(tmp_path):
    p = tmp_path / "run.tar.gz"
    p.write_bytes(_make_targz({"./run/run_basic/regions.js": BASIC_JS}))
    assert region_anchor_map(str(p))[("NODE_7", 1)] == "r89c1"


def test_select_regions_js_handles_archive_root_member():
    """regions.js at the archive root has no parent directory; must not raise."""
    from scripts.populator.adapters.anchors import select_regions_js
    assert select_regions_js(["regions.js"]) == "regions.js"
    assert select_regions_js(["regions.js", "./run/run_basic/regions.js"]) == "regions.js"


# The anchor pass also reports which tarballs carry a prescreen viewer, to avoid a
# second multi-hour sweep.

def test_region_anchor_map_with_candidates_reports_both_viewers(tmp_path):
    from scripts.populator.adapters.anchors import region_anchor_map_with_candidates
    p = tmp_path / "run.tar.gz"
    p.write_bytes(_make_targz({
        "./run/run_basic/regions.js": BASIC_JS,
        "./run/run/regions.js": FULL_JS,
    }))
    amap, candidates = region_anchor_map_with_candidates(str(p))
    assert amap[("NODE_7", 1)] == "r7c1"
    assert candidates == ["./run/run/regions.js", "./run/run_basic/regions.js"]


def test_region_anchor_map_with_candidates_single_viewer(tmp_path):
    from scripts.populator.adapters.anchors import region_anchor_map_with_candidates
    p = tmp_path / "run.tar.gz"
    p.write_bytes(_make_targz({"./run/run/regions.js": FULL_JS}))
    amap, candidates = region_anchor_map_with_candidates(str(p))
    assert candidates == ["./run/run/regions.js"]
    assert amap[("NODE_7", 1)] == "r7c1"


def test_region_anchor_map_with_candidates_unreadable(tmp_path):
    """A corrupt archive reports no candidates rather than raising."""
    from scripts.populator.adapters.anchors import region_anchor_map_with_candidates
    p = tmp_path / "garbage.tar.gz"
    p.write_bytes(b"not a tar")
    assert region_anchor_map_with_candidates(str(p)) == ({}, [])
