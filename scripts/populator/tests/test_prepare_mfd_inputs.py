import io
import zipfile

import pytest

from scripts.populator.tools.prepare_mfd_inputs import (
    SLIM_COLUMNS,
    _clean,
    _barcode_from_assembly_name,
    _parse_ena_tsv,
    _slim_row,
    read_xlsx,
)


def test_slim_columns_is_exact_13_column_list():
    assert SLIM_COLUMNS == [
        "fieldsample_barcode",
        "project_id",
        "sampling_date",
        "latitude",
        "longitude",
        "sitename",
        "coords_reliable",
        "mfd_sampletype",
        "mfd_areatype",
        "mfd_hab1",
        "mfd_hab2",
        "mfd_hab3",
        "habitat_typenumber",
    ]
    assert len(SLIM_COLUMNS) == 13


def test_clean_maps_missing_sentinels_to_none():
    for v in ("NA", "None", "", None):
        assert _clean(v) is None


def test_clean_keeps_real_values_verbatim():
    assert _clean("Soil") == "Soil"
    assert _clean("55.6771") == "55.6771"
    assert _clean("Yes") == "Yes"
    assert _clean(" leading space") == " leading space"


def test_barcode_derivation_strips_bin_suffix_and_gca_prefix():
    assert _barcode_from_assembly_name("MFD10113.bin.2.41") == "MFD10113"
    # trailing dot (seen in real ENA data)
    assert _barcode_from_assembly_name("MFD09212.bin.2.167.") == "MFD09212"
    assert _barcode_from_assembly_name("MFD00001") == "MFD00001"


def test_slim_row_projects_columns_in_order_and_blanks_missing():
    row = {c: c + "_val" for c in SLIM_COLUMNS}
    row["mfd_hab3"] = "NA"      # sentinel -> blank
    row["sitename"] = None       # absent -> blank
    row["mfd_hab2"] = ""         # empty -> blank
    out = _slim_row(row)
    assert len(out) == 13
    assert out[SLIM_COLUMNS.index("fieldsample_barcode")] == "fieldsample_barcode_val"
    assert out[SLIM_COLUMNS.index("mfd_sampletype")] == "mfd_sampletype_val"
    assert out[SLIM_COLUMNS.index("mfd_hab3")] == ""
    assert out[SLIM_COLUMNS.index("sitename")] == ""
    assert out[SLIM_COLUMNS.index("mfd_hab2")] == ""


_WORKBOOK_XML = (
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    '<sheets><sheet name="data" sheetId="1" r:id="rId1"/></sheets></workbook>'
)
_RELS_XML = (
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1"'
    ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"'
    ' Target="worksheets/sheet1.xml"/></Relationships>'
)
_SHARED_XML = (
    '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    ' count="5" uniqueCount="5">'
    "<si><t>col_a</t></si>"
    "<si><t>col_b</t></si>"
    "<si><t>col_z</t></si>"
    "<si><t>col_aa</t></si>"
    "<si><t>val_shared</t></si>"
    "</sst>"
)
# Columns A, B, Z, AA test length-first ordering (AA after Z); the data row mixes a
# shared string, a number, an inline string and an omitted cell.
_SHEET_XML = (
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    "<sheetData>"
    '<row r="1">'
    '<c r="AA1" t="s"><v>3</v></c>'
    '<c r="A1" t="s"><v>0</v></c>'
    '<c r="Z1" t="s"><v>2</v></c>'
    '<c r="B1" t="s"><v>1</v></c>'
    "</row>"
    '<row r="2">'
    '<c r="A2" t="s"><v>4</v></c>'
    '<c r="B2"><v>42</v></c>'
    '<c r="Z2" t="inlineStr"><is><t>inline_z</t></is></c>'
    "</row>"
    "</sheetData></worksheet>"
)


def _make_minimal_xlsx() -> io.BytesIO:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("xl/workbook.xml", _WORKBOOK_XML)
        z.writestr("xl/_rels/workbook.xml.rels", _RELS_XML)
        z.writestr("xl/sharedStrings.xml", _SHARED_XML)
        z.writestr("xl/worksheets/sheet1.xml", _SHEET_XML)
    buf.seek(0)
    return buf


def test_read_xlsx_resolves_shared_strings_orders_columns_and_maps_header():
    (sheet_name, rows), = list(read_xlsx(_make_minimal_xlsx()))
    assert sheet_name == "data"
    assert len(rows) == 1
    row = rows[0]
    assert list(row.keys()) == ["col_a", "col_b", "col_z", "col_aa"]
    assert row["col_a"] == "val_shared"
    assert row["col_b"] == "42"
    assert row["col_z"] == "inline_z"
    assert row["col_aa"] is None


_GOOD_ENA_HEADER = "accession\tassembly_name"


def test_parse_ena_tsv_skips_header_and_blank_lines_and_derives_barcode():
    text = "\n".join([
        _GOOD_ENA_HEADER,
        "GCA_963695025\tMFD10113.bin.2.41",
        "",  # blank line skipped
        "GCA_963728455\tMFD09212.bin.2.167.",
    ])
    rows = _parse_ena_tsv(text, min_rows=1)
    assert rows == [
        ("GCA_963695025", "MFD10113.bin.2.41", "MFD10113"),
        ("GCA_963728455", "MFD09212.bin.2.167.", "MFD09212"),
    ]


def test_parse_ena_tsv_rejects_wrong_header():
    # a garbage/HTML 200 or renamed fields
    with pytest.raises(ValueError, match="unexpected ENA response header"):
        _parse_ena_tsv("<html>error</html>", min_rows=1)


def test_parse_ena_tsv_rejects_empty_response():
    with pytest.raises(ValueError, match="unexpected ENA response header"):
        _parse_ena_tsv("", min_rows=1)


def test_parse_ena_tsv_refuses_implausibly_few_rows():
    # a truncated-but-200 response must not clobber the committed map
    text = _GOOD_ENA_HEADER + "\nGCA_1\tMFD00001.bin.1.1"
    with pytest.raises(ValueError, match="sanity floor"):
        _parse_ena_tsv(text, min_rows=1000)
