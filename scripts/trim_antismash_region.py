#!/usr/bin/env python3
"""Trim a full antiSMASH results JSON down to a single region for the web viewer.

Produces a small single-record JSON that the bgc-viewer (`JSONFileProvider`)
renders directly. Runs as a subprocess so the large parse never touches the
Next server's heap.

The input is streamed with ijson, never `json.load`: a full load of a 1 GB+ file
gets OOM-killed. The record comes from a byte-offset index for large files (see
`build_records_index`; `ANTISMASH_JSON_INDEX=0` disables it), otherwise from a
streaming scan. Metadata comes from the head and tail only (see `read_metadata`).

Usage:
  trim_antismash_region.py --json-path X.json --record-id CONTIG \
      --region-number 27 --out-path /path/.bgc-region-<id>.json

Prints a JSON line to stdout: {"recordId": ..., "regionNumber": ..., "keptFeatures": N}
"""
import argparse
import json
import os
import re
import sys
from decimal import Decimal

import ijson

# Comparison modules the viewer doesn't need and which dominate the payload.
# Dropping clusterblast leaves the MIBiG comparison panel empty.
HEAVY_MODULES = (
    "antismash.modules.clusterblast",
    "antismash.modules.cluster_compare",
)

# Top-level metadata keys the viewer keeps alongside the single trimmed record.
META_KEYS = ("version", "input_file", "taxon", "schema")

# Buffer ijson is fed while indexing; also the slack a lookup rewinds by, so it
# is stored in the index.
INDEX_BUF_SIZE = 64 * 1024

# Below this the streaming scan is already sub-second.
INDEX_MIN_BYTES = 64 * 1024 * 1024


class _CountingReader:
    """File wrapper that counts bytes pulled by ijson.

    The count before the current buffer is a lower bound on the offset of any
    event that buffer produced.
    """

    def __init__(self, fh):
        self._fh = fh
        self.consumed = 0
        self.before_current_buffer = 0

    def read(self, size):
        self.before_current_buffer = self.consumed
        data = self._fh.read(size)
        self.consumed += len(data)
        return data


def build_records_index(json_path, buf_size=INDEX_BUF_SIZE):
    """Map each record id to a lower bound on its byte offset, in one pass.

    Asking for `records.item.id` rather than `records.item` builds only the id
    strings, which is ~4x faster.
    """
    entries = []
    with open(json_path, "rb") as raw:
        reader = _CountingReader(raw)
        for record_id in ijson.items(reader, "records.item.id", buf_size=buf_size):
            entries.append([record_id, reader.before_current_buffer])
    return {"buf_size": buf_size, "records": entries}


def records_index_path(json_path):
    """Beside the JSON, so it is evicted and rebuilt together with it."""
    return json_path + ".records-index.json"


def save_records_index(json_path, index):
    """Write the index atomically, stamped with the file state it describes.

    Concurrent builders are harmless thanks to the rename; no lock is needed.
    """
    stat = os.stat(json_path)
    payload = dict(index, json_size=stat.st_size, json_mtime_ns=stat.st_mtime_ns)
    out_path = records_index_path(json_path)
    tmp_path = "%s.%d.tmp" % (out_path, os.getpid())
    with open(tmp_path, "w") as fh:
        json.dump(payload, fh)
    os.replace(tmp_path, out_path)


def load_records_index(json_path):
    """Return the saved index, or None if missing, unreadable or stale. A bad index
    only costs time: the caller falls back to the streaming scan."""
    try:
        with open(records_index_path(json_path)) as fh:
            index = json.load(fh)
        stat = os.stat(json_path)
    except (OSError, ValueError):
        return None
    if not isinstance(index, dict) or not isinstance(index.get("records"), list):
        return None
    if index.get("json_size") != stat.st_size:
        return None
    if index.get("json_mtime_ns") != stat.st_mtime_ns:
        return None
    return index


def record_from_index(json_path, index, record_id):
    """Read one record out of the results JSON using its indexed lower bound.

    Matches on `id`, not the first object in the window: one buffer can span
    several small records.
    """
    entries = index["records"]
    position = next((i for i, e in enumerate(entries) if e[0] == record_id), None)
    if position is None:
        return None

    buf_size = index.get("buf_size", INDEX_BUF_SIZE)
    start = max(0, entries[position][1] - buf_size)
    decoder = json.JSONDecoder()
    file_size = os.path.getsize(json_path)

    # Bounds are lower bounds, so a record can reach past the next one; widen
    # until found.
    for lookahead in (2, 4, 8, 32, None):
        end = entries[position + lookahead][1] if (
            lookahead is not None and position + lookahead < len(entries)
        ) else file_size
        with open(json_path, "rb") as fh:
            fh.seek(start)
            window = fh.read(end - start).decode("utf-8", "replace")
        cursor = 0
        while True:
            brace = window.find("{", cursor)
            if brace == -1:
                break
            try:
                candidate, _ = decoder.raw_decode(window, brace)
            except ValueError:
                cursor = brace + 1
                continue
            if isinstance(candidate, dict) and candidate.get("id") == record_id:
                return candidate
            cursor = brace + 1
        if end >= file_size:
            break
    return None


def span(location):
    nums = [int(x) for x in re.findall(r"\d+", location or "")]
    return (min(nums), max(nums)) if nums else (None, None)


def region_number_of(feature):
    raw = (feature.get("qualifiers", {}) or {}).get("region_number")
    if isinstance(raw, list):
        return str(raw[0]) if raw else None
    return str(raw) if raw is not None else None


def indexing_enabled(json_path):
    if os.environ.get("ANTISMASH_JSON_INDEX") == "0":
        return False
    try:
        return os.path.getsize(json_path) >= INDEX_MIN_BYTES
    except OSError:
        return False


def resolve_indexed_id(entries, record_id):
    """The id `select_record` would settle on: exact match beats the first fuzzy one.

    Never answers "the first record": records without an `id` are absent from the
    index, so that fallback stays with the streaming scan.
    """
    if not record_id:
        return None
    ids = [entry[0] for entry in entries if entry[0]]
    for rid in ids:
        if rid == record_id:
            return rid
    for rid in ids:
        if rid.startswith(record_id) or record_id.startswith(rid):
            return rid
    return None


def select_record(json_path, record_id):
    if record_id and indexing_enabled(json_path):
        index = load_records_index(json_path)
        if index is None:
            index = build_records_index(json_path)
            try:
                save_records_index(json_path, index)
            except OSError:
                pass  # a full or read-only cache costs speed, not the answer
        match = resolve_indexed_id(index["records"], record_id)
        if match is not None:
            found = record_from_index(json_path, index, match)
            if found is not None:
                return found
    return select_record_streaming(json_path, record_id)


def select_record_streaming(json_path, record_id):
    """Stream records and pick the target: exact contig match, then fuzzy
    (antiSMASH may truncate long names), then the first record. Peak memory is
    ~the largest single record.
    """
    target = None
    fuzzy = None
    first = None
    with open(json_path, "rb") as fh:
        # use_float: ijson's default Decimal can't be serialized by json.dump.
        for record in ijson.items(fh, "records.item", use_float=True):
            if first is None:
                first = record
            rid = record.get("id", "") or ""
            if record_id and rid == record_id:
                target = record
                break
            if (
                record_id
                and fuzzy is None
                and (rid.startswith(record_id) or record_id.startswith(rid))
            ):
                fuzzy = record
    return target or fuzzy or first


def read_metadata(json_path):
    """Collect the top-level scalar metadata without reading the whole file.

    antiSMASH writes `taxon` and `schema` after the `records` array, so streaming
    until all keys are found would read every byte. Instead parse the head up to
    `records` and regex the tail. Missing keys are omitted.
    """
    meta = {}
    wanted = set(META_KEYS)

    with open(json_path, "rb") as fh:
        for prefix, event, value in ijson.parse(fh, use_float=True):
            if prefix == "records" and event == "start_array":
                break  # everything past here is the payload, not metadata
            if prefix in wanted and event in ("string", "number", "boolean", "null"):
                meta[prefix] = value

    missing = wanted - set(meta)
    if missing:
        meta.update(read_trailing_metadata(json_path, missing))

    return meta


# A trailing top-level scalar pair such as `"schema": 4`.
_TRAILING_PAIR = r'"%s"\s*:\s*("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?|true|false|null)\s*(?=[,}])'

TAIL_BYTES = 64 * 1024


def read_trailing_metadata(json_path, keys):
    """Recover metadata keys appended after `records` from the last 64KB. Takes the
    last match per key (the top-level pair in a well-formed document)."""
    found = {}
    with open(json_path, "rb") as fh:
        fh.seek(0, 2)
        size = fh.tell()
        fh.seek(max(0, size - TAIL_BYTES))
        tail = fh.read().decode("utf-8", errors="ignore")

    for key in keys:
        matches = re.findall(_TRAILING_PAIR % re.escape(key), tail)
        if matches:
            try:
                found[key] = json.loads(matches[-1])
            except ValueError:
                pass
    return found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json-path", required=True)
    ap.add_argument("--record-id", default="")  # bgcs.contig
    ap.add_argument("--region-number", type=int, default=0)  # from the rNcM anchor
    ap.add_argument("--out-path", required=True)
    args = ap.parse_args()

    record = select_record(args.json_path, args.record_id)
    if record is None:
        print(json.dumps({"error": "no records"}))
        return 2

    features = record.get("features", [])

    region = None
    if args.region_number:
        region = next(
            (f for f in features
             if f.get("type") == "region"
             and region_number_of(f) == str(args.region_number)),
            None,
        )
    if region is None:
        region = next((f for f in features if f.get("type") == "region"), None)
    if region is None:
        print(json.dumps({"error": "no region feature"}))
        return 3

    region_start, region_end = span(region.get("location"))

    def keep(feature):
        if feature is region:
            return True
        if feature.get("type") == "region":
            return False  # drop sibling regions so only ours is shown
        fs, fe = span(feature.get("location"))
        return fs is not None and fs < region_end and fe > region_start

    kept = [f for f in features if keep(f)]

    modules = {
        k: v for k, v in (record.get("modules") or {}).items()
        if k not in HEAVY_MODULES
    }

    trimmed_record = dict(record)
    trimmed_record["features"] = kept
    trimmed_record["seq"] = ""
    trimmed_record["modules"] = modules
    trimmed_record.pop("letter_annotations", None)

    meta = read_metadata(args.json_path)
    out = {k: meta[k] for k in META_KEYS if k in meta}
    out["records"] = [trimmed_record]

    with open(args.out_path, "w") as fh:
        # Any stray Decimal becomes a float rather than aborting mid-write.
        json.dump(out, fh, default=lambda o: float(o) if isinstance(o, Decimal) else str(o))

    print(json.dumps({
        "recordId": record.get("id"),
        "regionNumber": region_number_of(region),
        "keptFeatures": len(kept),
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
