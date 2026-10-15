import hashlib
import io
import tarfile
import zlib

from scripts.export.repack_regions_gbk import repack


def _tar(files: dict, fmt=tarfile.GNU_FORMAT) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w", format=fmt) as tf:
        for name, data in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tf.addfile(info, io.BytesIO(data))
    return buf.getvalue()


def _run(raw: bytes, workers=2, batch_bytes=1024):
    out, index = io.BytesIO(), io.StringIO()
    summary = repack(io.BytesIO(raw), out, index, workers, batch_bytes=batch_bytes, log=io.StringIO())
    rows = [line.split("\t") for line in index.getvalue().splitlines()]
    return out.getvalue(), rows, summary


FILES = {
    "ef1e0ff2-a653-52b8-a80a-6026c43c8374.gbk": b"LOCUS one\n" * 300,
    "5fefcc41-8f4b-572f-8f9a-616aa05777e6.gbk": b"LOCUS two\n" * 7,
    "x" * 150 + ".gbk": b"LOCUS long name\n",  # forces a GNU longname header
    "empty.gbk": b"",
}


def test_output_inflates_to_the_identical_tar_stream():
    raw = _tar(FILES)
    gz, rows, summary = _run(raw)
    assert zlib.decompress(gz, 47) != b""  # one member is valid gzip...
    # ...and all members, concatenated, are the original tar byte for byte.
    assert _inflate_all(gz) == raw
    assert summary["input_sha256"] == hashlib.sha256(raw).hexdigest()
    assert summary["members"] == len(FILES)


def test_output_is_an_ordinary_tar_gz():
    gz, _, _ = _run(_tar(FILES))
    with tarfile.open(fileobj=io.BytesIO(gz), mode="r:gz") as tf:
        got = {m.name: tf.extractfile(m).read() for m in tf}
    assert got == FILES


def test_each_indexed_member_is_readable_alone():
    gz, rows, _ = _run(_tar(FILES))
    assert [r[0] for r in rows] == list(FILES)
    for name, offset, length, size in rows:
        member = zlib.decompress(gz[int(offset):int(offset) + int(length)], 31)
        with tarfile.open(fileobj=io.BytesIO(member + b"\0" * 1024), mode="r:") as tf:
            m = tf.next()
            assert m.name == name
            assert int(size) == m.size
            assert tf.extractfile(m).read() == FILES[name]


def test_pax_headers_travel_with_their_file():
    files = {"ü" * 60 + ".gbk": b"LOCUS pax\n", "plain.gbk": b"LOCUS plain\n"}
    gz, rows, _ = _run(_tar(files, fmt=tarfile.PAX_FORMAT))
    assert [r[0] for r in rows] == list(files)
    assert _inflate_all(gz) == _tar(files, fmt=tarfile.PAX_FORMAT)


def _inflate_all(gz: bytes) -> bytes:
    out = []
    while gz:
        d = zlib.decompressobj(31)
        out.append(d.decompress(gz))
        gz = d.unused_data
    return b"".join(out)
