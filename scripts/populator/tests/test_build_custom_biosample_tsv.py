import json

from scripts.populator.tools.build_custom_biosample_tsv import attributes, missing, number, row_for


def _xml(tmp_path, attrs, title="T1"):
    body = "".join(f"<SAMPLE_ATTRIBUTE><TAG>{t}</TAG><VALUE>{v}</VALUE>{f'<UNITS>{u}</UNITS>' if u else ''}"
                   f"</SAMPLE_ATTRIBUTE>" for t, v, u in attrs)
    p = tmp_path / "s.xml"
    p.write_text(f"<SAMPLE_SET><SAMPLE><TITLE>{title}</TITLE><SAMPLE_ATTRIBUTES>{body}"
                 f"</SAMPLE_ATTRIBUTES></SAMPLE></SAMPLE_SET>", encoding="utf-8")
    return p


def test_number_is_strict():
    assert number("54.19") == "54.19" and number("-11.35312") == "-11.35312"
    assert number("11.35 S") == "" and number("0-5") == "" and number("1e2") == ""
    assert number("3.1", "m", {"", "m"}) == "3.1" and number("10", "ft", {"", "m"}) == ""


def test_missing_values_and_first_tag_wins(tmp_path):
    p = _xml(tmp_path, [("geographic location (country and/or sea)", "missing: not provided", ""),
                        ("depth", "3.1", "m"), ("depth", "99", "m")])
    attrs, units, title = attributes(p)
    assert "geographic location (country and/or sea)" not in attrs
    assert attrs["depth"] == "3.1" and units["depth"] == "m" and title == "T1"
    assert missing("not collected") and missing("Missing: restricted access") and not missing("North Sea")


def test_row_copies_values_and_drops_what_it_cannot_read(tmp_path):
    p = _xml(tmp_path, [("geographic location (latitude)", "-11.35312", "DD"),
                        ("geographic location (longitude)", "143.3 E", "DD"),
                        ("collection date", "2019-11-25T14:51:00", ""),
                        ("depth", "10", "ft"),
                        ("environment (biome)", "marine biome [ENVO:00000447]", ""),
                        ("environment (material)", "sea water (ENVO:00002149)", ""),
                        ("Reef sector", "Cape Grenville", "")])
    attrs, units, title = attributes(p)
    r = row_for("ERZ1", "SAMEA1", "PacBio HiFi", attrs, title, units)
    assert r["latitude"] == "-11.35312" and r["longitude"] == ""      # hemisphere letter: not read
    assert r["collection_date"] == "2019-11-25" and r["depth_m"] == ""  # feet: not read as metres
    assert r["environment_biome"] == "marine biome" and r["environment_material"] == "sea water"
    assert json.loads(r["extra"]) == {"Reef sector": "Cape Grenville"} and r["platform"] == "PacBio HiFi"


def test_date_range_stays_empty(tmp_path):
    p = _xml(tmp_path, [("collection date", "2019-11-25T10:00/2019-11-28", "")])
    attrs, units, title = attributes(p)
    assert row_for("ERZ1", "SAMEA1", "", attrs, title, units)["collection_date"] == ""
