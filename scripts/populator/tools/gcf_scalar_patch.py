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
                        [--dry-run] [--sample N] [--resume]

DISABLED OBJECTS

--type <field>:object-disabled maps a --json column as {"type": "object",
"enabled": false}: stored in _source for display, never indexed. A per-family
distribution keyed by arbitrary labels (product_type_member_share) must not
reach the dynamic mapping, where every new key would become a field. A plain `--type <field>:object` would do exactly that.

DRY RUN

--dry-run does everything up to the first write and stops: it loads the map,
reads the source mapping and settings, validates every column's type, prints
the properties it would add, and shows before/after for up to --sample N
(default 3) documents the map covers -- read with one small terms query, not a
scroll. It creates nothing. Use it on a LIMIT-ed map before the real run.

EXISTING DESTINATION

The destination is created by this tool. If it already exists -- a leftover from
an aborted run, or a name typed twice -- the tool refuses, because writing into
it would top up an index of unknown content rather than build a known one. Pass
--resume to continue into it deliberately. Any other error creating it (a bad
mapping, say) aborts before a single _bulk: the cluster auto-creates indexes, so
a _bulk into a missing destination would succeed with a guessed mapping.

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
DISABLED_OBJECT = "object-disabled"


def field_mapping(kind: str) -> dict:
    """The mapping a --type kind stands for. object-disabled: see DISABLED OBJECTS."""
    if kind == DISABLED_OBJECT:
        return {"type": "object", "enabled": False}
    return {"type": kind}


def plan_properties(properties: dict, fields: list[str], types: dict[str, str],
                    src: str) -> tuple[dict, list[str]]:
    """The destination's properties, or the reasons to refuse.

    An existing field must already have the mapping its --type asks for, because
    a field cannot be remapped in place; a new one must be given a --type, so
    that adding one is a deliberate act rather than a dynamic-template guess.
    """
    out = dict(properties)
    errors: list[str] = []
    for field in fields:
        if field in out:
            if field in types:
                wanted = field_mapping(types[field])
                if any(out[field].get(k) != v for k, v in wanted.items()):
                    errors.append(f"--type {field}:{types[field]} contradicts the source mapping "
                                  f"({out[field]}); an existing field cannot be remapped in place")
            continue
        if field not in types:
            errors.append(f"{field} is not in {src}'s mapping and has no --type; refusing to let "
                          f"the dynamic template guess")
            continue
        out[field] = field_mapping(types[field])
    return out, errors


# Every option the tool knows. Anything else starting with "--" is REFUSED rather
# than taken for a positional: `--dryrun` must never start a real patch.
VALUE_OPTIONS = {"--type", "--list", "--json", "--scroll", "--chunk", "--id-field",
                 "--alias", "--sample"}
FLAG_OPTIONS = {"--dry-run", "--resume"}


def usage_error(message: str):
    print(f"{message}\n\n{__doc__}", file=sys.stderr)
    raise SystemExit(2)


def parse_args(argv: list[str]):
    types: dict[str, str] = {}
    lists: set[str] = set()
    jsons: set[str] = set()
    scroll = chunk = 2000
    id_field, alias = "gcf_id", "gcf_browse"
    dry_run, sample, resume = False, 3, False
    positional: list[str] = []
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg in FLAG_OPTIONS:
            if arg == "--dry-run":
                dry_run = True
            else:
                resume = True
            i += 1
            continue
        if arg in VALUE_OPTIONS:
            if i + 1 >= len(argv):
                usage_error(f"{arg} needs a value")
            value = argv[i + 1]
            i += 2
            if arg == "--type":
                field, sep, kind = value.partition(":")
                if not sep or not field or not kind:
                    usage_error(f"--type takes field:kind, got {value!r}")
                types[field] = kind
            elif arg == "--list":
                lists.add(value)
            elif arg == "--json":
                jsons.add(value)
            elif arg == "--scroll":
                scroll = int(value)
            elif arg == "--chunk":
                chunk = int(value)
            # For other browse indexes, e.g. sample_browse is keyed on sample_id.
            elif arg == "--id-field":
                id_field = value
            elif arg == "--alias":
                alias = value
            elif arg == "--sample":
                sample = int(value)
            continue
        if arg.startswith("-"):
            usage_error(f"unknown option {arg}")
        positional.append(arg)
        i += 1
    if len(positional) != 4:
        usage_error(f"expected 4 positionals <map.tsv> <os-url> <src> <dst>, got {len(positional)}: "
                    f"{positional}")
    return (positional[0], positional[1].rstrip("/"), positional[2], positional[3],
            types, lists, jsons, scroll, chunk, id_field, alias, dry_run, sample, resume)


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
        except urllib.error.HTTPError:
            raise  # an answer, not a network blip: retrying a 400 changes nothing
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


def create_destination(dst: str, body: dict, resume: bool) -> bool:
    """Create dst; see EXISTING DESTINATION. False means stop before any write."""
    try:
        req("PUT", f"/{dst}", body)
        print(f"created {dst}", flush=True)
        return True
    except urllib.error.HTTPError as e:
        try:
            error = json.loads(e.read() or b"{}").get("error", {})
        except ValueError:
            error = {}
        kind = error.get("type") if isinstance(error, dict) else None
        if kind == "resource_already_exists_exception":
            if resume:
                print(f"{dst} already exists; --resume given, continuing into it", flush=True)
                return True
            print(f"{dst} already exists. Refusing to write into an index this run did not "
                  f"create; delete it, pick another name, or pass --resume", file=sys.stderr)
            return False
        print(f"creating {dst} failed ({e.code} {kind}): {json.dumps(error)[:600]} -- nothing "
              f"was written", file=sys.stderr)
        return False


def dry_run(src: str, dst: str, src_properties: dict, properties: dict, src_set: dict,
            fields: list[str], values: dict[str, dict], id_field: str, sample: int) -> int:
    """Everything before the first write; see DRY RUN in the module docstring."""
    added = {f: properties[f] for f in properties if f not in src_properties}
    total = req("GET", f"/{src}/_count")["count"]
    print(f"DRY RUN -- nothing will be created. {src}: {total:,} documents, "
          f"max_result_window {src_set.get('max_result_window')} (carried: "
          f"{carried_settings(src_set)})")
    # The real run CONTINUES into an existing destination rather than failing, so
    # a leftover from an aborted run would be topped up, not rebuilt. Say so now.
    existing = [i["index"] for i in req("GET", f"/_cat/indices/{dst}*?format=json")
                if i["index"] == dst]
    if existing:
        print(f"WARNING: {dst} already exists; the real run will refuse unless --resume. "
              f"Delete it or pick another name first.")
    print(f"{dst} would add {len(added)} properties:")
    for field, mapping in added.items():
        print(f"  {field:28s} {json.dumps(mapping)}")
    print(f"and overwrite {len(fields) - len(added)} existing ones: "
          f"{[f for f in fields if f not in added]}")
    ids = list(values)[:max(sample * 50, 500)]
    hits = req("POST", f"/{src}/_search", {
        "size": sample, "query": {"terms": {id_field: ids}},
        "_source": [id_field, *fields]})["hits"]["hits"]
    covered = req("POST", f"/{src}/_count", {"query": {"terms": {id_field: ids}}})["count"]
    print(f"{covered:,} of the first {len(ids):,} map ids are documents in {src}")
    for h in hits:
        doc = h["_source"]
        row = values[doc[id_field]]
        print(f"\n{doc[id_field]}")
        for field in fields:
            before, after = doc.get(field), row.get(field)
            mark = "  " if before == after else "* "
            print(f"  {mark}{field:28s} {json.dumps(before)[:70]:72s} -> {json.dumps(after)[:70]}")
    return 0
def main() -> int:
    global OS
    (MAP_PATH, OS, SRC, DST, TYPES, LISTS, JSONS, SCROLL_SIZE, BULK_CHUNK,
     ID_FIELD, ALIAS, DRY_RUN, SAMPLE, RESUME) = parse_args(sys.argv[1:])
    fields, values = load_map(MAP_PATH, LISTS, JSONS, ID_FIELD)
    print(f"map: {len(values):,} families, fields {fields}", flush=True)
    if not values:
        print("map is empty -- refusing to run", file=sys.stderr)
        return 1

    src_map = req("GET", f"/{SRC}/_mapping")[SRC]["mappings"]
    src_set = req("GET", f"/{SRC}/_settings")[SRC]["settings"]["index"]
    src_properties = src_map.get("properties", {})
    properties, errors = plan_properties(src_properties, fields, TYPES, SRC)
    for error in errors:
        print(error, file=sys.stderr)
    if errors:
        return 1
    if DRY_RUN:
        return dry_run(SRC, DST, src_properties, properties, src_set, fields, values,
                       ID_FIELD, SAMPLE)

    body = {
        "settings": {"index": {
            **carried_settings(src_set),
            "number_of_replicas": "0",       # restored after load
            "refresh_interval": "-1",        # ditto -- bulk load goes much faster
        }},
        "mappings": dict(src_map, properties=properties),
    }
    if not create_destination(DST, body, RESUME):
        return 1

    res = req("POST", f"/{SRC}/_search?scroll={SCROLL_TTL}",
              {"size": SCROLL_SIZE, "query": {"match_all": {}}, "sort": ["_doc"]})
    sid = res["_scroll_id"]
    total = res["hits"]["total"]["value"]
    print(f"scrolling {total:,} docs", flush=True)

    seen = unmapped = changed = 0
    set_count = {f: 0 for f in fields}
    changed_count = {f: 0 for f in fields}
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
                differs = [f for f in fields if before[f] != doc.get(f)]
                for f in differs:
                    changed_count[f] += 1
                if differs:
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
    # Per field, because the document total says nothing when new fields land on
    # every family: what matters is how many OVERWRITTEN values actually moved.
    for f in fields:
        print(f"  {f:28s} set on {set_count[f]:>8,}  ({100 * set_count[f] / max(seen, 1):5.1f}%)"
              f"  changed on {changed_count[f]:>8,}")

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
