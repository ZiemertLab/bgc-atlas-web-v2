#!/usr/bin/env python3
"""Set scalar fields on gcf_browse from a SQL-derived map, by scrolling the index.

Values are computed in SQL and only transported here, so the browse index and the
SQL fallback answer identically. The map must cover every scrolled document, or
the alias swap is refused.

Map: tab-separated with a header line; column 1 is gcf_id, the rest are index
field names. An empty value removes the field (queries rely on `exists`).

    psql -At -F$'\\t' -d bgc_atlas_v2 \\
      -c "SELECT 'gcf_id','length_est'" \\
      -c "SELECT gcf_id, COALESCE(len::text,'') FROM ..." > map.tsv

A field not in the source mapping needs --type. --list <field> splits the value on
\x1f (chr(31) in SQL) into a keyword array of strings. --json <field> writes the
value as parsed JSON ('{}' stays an empty object).

Usage:
    gcf_scalar_patch.py <map.tsv> <os-url> <src> <dst> [--type field:keyword ...]
                        [--list field ...] [--json field ...] [--scroll N] [--chunk N]
                        [--id-field gcf_id] [--alias gcf_browse]

Alias promotion is not done here: verify first, then swap with the printed call.
"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request

SCROLL_TTL = "15m"
LIST_SEPARATOR = "\x1f"


def parse_args(argv: list[str]):
    types: dict[str, str] = {}
    lists: set[str] = set()
    jsons: set[str] = set()
    scroll = chunk = 2000
    id_field, alias = "gcf_id", "gcf_browse"
    positional: list[str] = []
    i = 0
    while i < len(argv):
        if argv[i] == "--type":
            field, _, kind = argv[i + 1].partition(":")
            types[field] = kind
            i += 2
            continue
        if argv[i] == "--list":
            lists.add(argv[i + 1])
            i += 2
            continue
        if argv[i] == "--json":
            jsons.add(argv[i + 1])
            i += 2
            continue
        if argv[i] == "--scroll":
            scroll = int(argv[i + 1])
            i += 2
            continue
        if argv[i] == "--chunk":
            chunk = int(argv[i + 1])
            i += 2
            continue
        # For other browse indexes, e.g. sample_browse is keyed on sample_id.
        if argv[i] == "--id-field":
            id_field = argv[i + 1]
            i += 2
            continue
        if argv[i] == "--alias":
            alias = argv[i + 1]
            i += 2
            continue
        positional.append(argv[i])
        i += 1
    if len(positional) < 4:
        print(__doc__, file=sys.stderr)
        raise SystemExit(2)
    return (positional[0], positional[1].rstrip("/"), positional[2], positional[3],
            types, lists, jsons, scroll, chunk, id_field, alias)


# Set by main(). Parsed there rather than at import so load_map can be tested.
OS = ""


def req(method, path, body=None, timeout=300, raw=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    ct = "application/x-ndjson" if raw is not None else "application/json"
    r = urllib.request.Request(OS + path, data=data,
                               headers={"Content-Type": ct} if data else {}, method=method)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(r, timeout=timeout) as resp:
                return json.loads(resp.read())
        except (urllib.error.URLError, TimeoutError):
            if attempt == 3:
                raise
            time.sleep(2 * (attempt + 1))


def coerce(raw: str):
    """Numbers as numbers, everything else as text, so OpenSearch doesn't pick the type."""
    try:
        return int(raw)
    except ValueError:
        pass
    try:
        return float(raw)
    except ValueError:
        return raw


def carried_settings(src_index_settings: dict) -> dict:
    """Index settings the destination must inherit. Without max_result_window,
    deep /gcfs paging silently breaks."""
    carried = {"number_of_shards": src_index_settings.get("number_of_shards", "1")}
    if "max_result_window" in src_index_settings:
        carried["max_result_window"] = src_index_settings["max_result_window"]
    return carried


def parse_value(field: str, raw: str, lists: set[str], jsons: set[str] = frozenset()):
    if field in jsons:
        return json.loads(raw)
    if field in lists:
        return [element for element in raw.split(LIST_SEPARATOR) if element]
    return coerce(raw)


def load_map(path: str, lists: set[str] = frozenset(),
             jsons: set[str] = frozenset(),
             id_field: str = "gcf_id") -> tuple[list[str], dict[str, dict]]:
    out: dict[str, dict] = {}
    with open(path, encoding="utf-8") as fh:
        header = fh.readline().rstrip("\n").split("\t")
        if not header or header[0] != id_field:
            raise SystemExit(f"map's first column must be {id_field}, and line 1 must be a header")
        fields = header[1:]
        if not fields:
            raise SystemExit("map names no fields")
        unknown = (set(lists) | set(jsons)) - set(fields)
        if unknown:
            raise SystemExit(f"--list/--json name columns the map does not have: {sorted(unknown)}")
        for line in fh:
            parts = line.rstrip("\n").split("\t")
            if len(parts) != len(header):
                continue
            out[parts[0]] = {f: parse_value(f, v, lists, jsons)
                             for f, v in zip(fields, parts[1:]) if v != ""}
    return fields, out


def install_opensearch_auth() -> None:
    """Route every urllib request through the cluster's credentials and CA.

    Verification is never switched off. Standalone scripts carry identical
    copies of this function; a test keeps them in sync.
    """
    import base64
    import os
    import ssl
    import urllib.request

    handlers = []
    ca = os.environ.get("OPENSEARCH_CA_CERT")
    if ca:
        handlers.append(urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=ca)))
    opener = urllib.request.build_opener(*handlers)
    user = os.environ.get("OPENSEARCH_USERNAME")
    if user:
        token = base64.b64encode(f"{user}:{os.environ.get('OPENSEARCH_PASSWORD', '')}".encode()).decode()
        opener.addheaders = [("Authorization", f"Basic {token}")]
    urllib.request.install_opener(opener)


def main() -> int:
    global OS
    (MAP_PATH, OS, SRC, DST, TYPES, LISTS, JSONS, SCROLL_SIZE, BULK_CHUNK,
     ID_FIELD, ALIAS) = parse_args(sys.argv[1:])
    fields, values = load_map(MAP_PATH, LISTS, JSONS, ID_FIELD)
    print(f"map: {len(values):,} families, fields {fields}", flush=True)
    if not values:
        print("map is empty -- refusing to run", file=sys.stderr)
        return 1

    src_map = req("GET", f"/{SRC}/_mapping")[SRC]["mappings"]
    src_set = req("GET", f"/{SRC}/_settings")[SRC]["settings"]["index"]
    properties = dict(src_map.get("properties", {}))

    for field in fields:
        if field in properties:
            if field in TYPES and TYPES[field] != properties[field].get("type"):
                print(f"--type {field}:{TYPES[field]} contradicts the source mapping "
                      f"({properties[field].get('type')}); an existing field cannot be remapped "
                      f"in place", file=sys.stderr)
                return 1
            continue
        if field not in TYPES:
            print(f"{field} is not in {SRC}'s mapping and has no --type; refusing to let the "
                  f"dynamic template guess", file=sys.stderr)
            return 1
        properties[field] = {"type": TYPES[field]}

    body = {
        "settings": {"index": {
            **carried_settings(src_set),
            "number_of_replicas": "0",       # restored after load
            "refresh_interval": "-1",        # ditto -- bulk load goes much faster
        }},
        "mappings": dict(src_map, properties=properties),
    }
    try:
        req("PUT", f"/{DST}", body)
        print(f"created {DST}", flush=True)
    except urllib.error.HTTPError as e:
        if e.code != 400:
            raise
        print(f"{DST} already exists, continuing", flush=True)

    res = req("POST", f"/{SRC}/_search?scroll={SCROLL_TTL}",
              {"size": SCROLL_SIZE, "query": {"match_all": {}}, "sort": ["_doc"]})
    sid = res["_scroll_id"]
    total = res["hits"]["total"]["value"]
    print(f"scrolling {total:,} docs", flush=True)

    seen = unmapped = changed = 0
    set_count = {f: 0 for f in fields}
    t0 = time.time()
    lines: list[str] = []
    while True:
        hits = res["hits"]["hits"]
        if not hits:
            break
        for h in hits:
            doc = h["_source"]
            gcf_id = doc.get(ID_FIELD)
            row = values.get(gcf_id)
            if row is None:
                unmapped += 1
            else:
                before = {f: doc.get(f) for f in fields}
                for f in fields:
                    doc.pop(f, None)
                doc.update(row)
                for f in row:
                    set_count[f] += 1
                if any(before[f] != doc.get(f) for f in fields):
                    changed += 1
            lines.append(json.dumps({"index": {"_id": h["_id"]}}) + "\n")
            lines.append(json.dumps(doc) + "\n")
            seen += 1
        if len(lines) >= BULK_CHUNK * 2:
            r = req("POST", f"/{DST}/_bulk", raw="".join(lines).encode())
            if r.get("errors"):
                bad = [i for i in r["items"] if i.get("index", {}).get("error")][:3]
                print(f"BULK ERRORS: {json.dumps(bad)[:400]}", file=sys.stderr, flush=True)
                return 1
            lines = []
            print(f"  {seen:,}/{total:,} ({seen / (time.time() - t0):.0f}/s)", flush=True)
        res = req("POST", "/_search/scroll", {"scroll": SCROLL_TTL, "scroll_id": sid})
        sid = res["_scroll_id"]

    if lines:
        r = req("POST", f"/{DST}/_bulk", raw="".join(lines).encode())
        if r.get("errors"):
            print("BULK ERRORS in final chunk", file=sys.stderr)
            return 1

    req("PUT", f"/{DST}/_settings", {"index": {"refresh_interval": "1s",
                                               "number_of_replicas": "0"}})
    req("POST", f"/{DST}/_refresh")
    dst_count = req("GET", f"/{DST}/_count")["count"]

    print(f"\ndone: {seen:,} scrolled, {dst_count:,} in {DST}, {changed:,} documents changed")
    for f in fields:
        print(f"  {f:24s} set on {set_count[f]:>8,}  ({100 * set_count[f] / max(seen, 1):5.1f}%)")

    if unmapped:
        print(f"{unmapped:,} scrolled families were absent from the map -- they kept their old "
              f"values, which is indistinguishable from correct ones. Do NOT swap the alias",
              file=sys.stderr)
        return 1
    dst_set = req("GET", f"/{DST}/_settings")[DST]["settings"]["index"]
    if dst_set.get("max_result_window") != src_set.get("max_result_window"):
        print(f"max_result_window differs: src {src_set.get('max_result_window')} vs dst "
              f"{dst_set.get('max_result_window')} -- do NOT swap the alias", file=sys.stderr)
        return 1
    if dst_count != total:
        print(f"COUNT MISMATCH: src {total:,} vs dst {dst_count:,} -- do NOT swap the alias",
              file=sys.stderr)
        return 1
    print(f"counts match, every family mapped. Promote with:\n"
          f"  oscurl -XPOST {OS}/_aliases -H 'Content-Type: application/json' -d '"
          f'{{"actions":[{{"remove":{{"index":"{SRC}","alias":"{ALIAS}"}}}},'
          f'{{"add":{{"index":"{DST}","alias":"{ALIAS}"}}}}]}}\'')
    return 0


if __name__ == "__main__":
    install_opensearch_auth()
    sys.exit(main())
