#!/usr/bin/env python3
"""Rewrite a known subset of browse/facet documents in a clone of the live index.

Regenerates the affected documents from the same projection a rebuild uses
(build_browse_corpus.BROWSE_INDEX_CONFIGS; for bgc_facets only the sample fields,
since that index carries backfills no projection reproduces), diffs them against
the live documents, and refuses if a field would be dropped. With --apply it
clones the live index and writes into the clone. No alias is moved.

Usage:
  browse_subset_patch.py <bgcs|samples|gcfs|facets> <ids.txt> <dst-index> [--apply]
      [--os URL] [--allow-drop field ...] [--delete-missing] [--delete]

  --delete-missing  documents live in the index that the projection no longer
                    produces are DELETED from the clone instead of refused (a family
                    that stopped being listed).
  --delete          no regeneration: delete exactly the given ids from the clone
                    (removed BGCs). Every id must exist live; the clone must end at
                    the live count minus the ids.

  ids.txt: bgc ids (bgcs, facets), sample ids (samples) or gcf ids (gcfs), one per line.
  DATABASE_URL (or PGDATABASE) selects the database, as for build_browse_corpus.py.
"""
from __future__ import annotations

import collections
import json
import os
import sys
import urllib.error
import urllib.request

import psycopg2
import psycopg2.extras

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..")))
from scripts.populator.tools.build_browse_corpus import (  # noqa: E402
    BROWSE_INDEX_CONFIGS, database_connection_args, enrich_document, normalize_document)

ALIASES = {"bgcs": "bgc_browse", "samples": "sample_browse", "gcfs": "gcf_browse",
           "facets": "bgc_facets"}

# (anchor, replacement-with-{ids}). The anchor must occur exactly once, so a
# reworded projection fails loudly.
NARROW = {
    "bgcs": ("\n            ORDER BY b.id\n",
             "\n            WHERE b.id = ANY({ids}::uuid[])\n            ORDER BY b.id\n"),
    "samples": ("WHERE sb.external_id IS NOT NULL",
                "WHERE sb.external_id IS NOT NULL AND sb.id = ANY({ids}::uuid[])"),
    "gcfs": ("WHERE g.listed\n", "WHERE g.listed AND g.gcf_id = ANY({ids}::uuid[])\n"),
}

# resolve_facets.py _PROJ_SQL, sample columns only; DISTINCT ON + ORDER BY as there.
FACET_SAMPLE_SQL = """
SELECT DISTINCT ON (b.id) b.id::text AS bgc_id,
       a.source_type AS sample_type,
       s.environment_biome AS biome,
       s.environment_feature AS env_feature,
       s.environment_material AS env_material,
       s.environmental_package AS env_package,
       s.host_scientific_name AS host,
       s.geolocation_name AS geolocation,
       s.latitude AS latitude, s.longitude AS longitude,
       s.gold_ecosystem_path AS gold_ecosystem,
       EXTRACT(YEAR FROM s.collection_date)::int AS collection_year
FROM bgcs b
LEFT JOIN assemblies a ON b.assembly = a.id
LEFT JOIN sample_assemblies sa ON sa.assembly_id = a.id
LEFT JOIN samples s ON sa.sample_id = s.id
WHERE b.id = ANY(%s::uuid[])
ORDER BY b.id, s.id NULLS LAST
"""
# sample_type (= assemblies.source_type): retyping a genome (SPIRE specI MAG -> isolate) must
# reach the facet documents too, and resolve_facets.py derives it the same way.
FACET_FIELDS = ("biome", "env_feature", "env_material", "env_package", "host", "geolocation",
                "latitude", "longitude", "gold_ecosystem", "collection_year", "sample_type")


def http(os_url: str, method: str, path: str, body=None, ndjson: bool = False):
    data = None
    if body is not None:
        data = body.encode() if ndjson else json.dumps(body).encode()
    req = urllib.request.Request(
        os_url + path, data=data, method=method,
        headers={"Content-Type": "application/x-ndjson" if ndjson else "application/json"})
    with urllib.request.urlopen(req, timeout=600) as resp:
        return json.load(resp)


def index_exists(os_url: str, index: str) -> bool:
    try:
        urllib.request.urlopen(urllib.request.Request(os_url + "/" + index, method="HEAD"),
                               timeout=60)
        return True
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return False
        raise


def clone_index(os_url: str, src: str, dst: str) -> None:
    if not index_exists(os_url, dst):
        print(f"cloning {src} -> {dst}")
        # _clone resets number_of_replicas to 1, which leaves a one-node cluster yellow.
        replicas = http(os_url, "GET", f"/{src}/_settings/index.number_of_replicas")[src][
            "settings"]["index"]["number_of_replicas"]
        http(os_url, "PUT", f"/{src}/_settings", {"index.blocks.write": True})
        try:
            http(os_url, "POST", f"/{src}/_clone/{dst}",
                 {"settings": {"index.blocks.write": None,
                               "index.number_of_replicas": replicas}})
        finally:
            http(os_url, "PUT", f"/{src}/_settings", {"index.blocks.write": None})
        http(os_url, "GET", f"/_cluster/health/{dst}?wait_for_status=yellow&timeout=10m")
    else:
        print(f"{dst} exists; writing into it")


def regenerate(entity: str, ids: list[str]) -> dict[str, dict]:
    with psycopg2.connect(**database_connection_args()) as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SET statement_timeout = 0")
            cur.execute("SET work_mem = '64MB'")
            # Literal ids, never a subquery: the planner sorts all of bgcs otherwise.
            literal = cur.mogrify("%s", (ids,)).decode()
            if entity == "facets":
                cur.execute(FACET_SAMPLE_SQL, (ids,))
                docs = {}
                for row in cur.fetchall():
                    d = normalize_document(dict(row))
                    docs[d.pop("bgc_id")] = d
                return docs
            config = BROWSE_INDEX_CONFIGS[entity]
            anchor, replacement = NARROW[entity]
            if config.sql.count(anchor) != 1:
                raise SystemExit(f"{entity}: narrowing anchor not found exactly once; "
                                 "the projection changed -- update NARROW")
            cur.execute(config.sql.replace(anchor, replacement.format(ids=literal)))
            docs = {}
            for row in cur.fetchall():
                d = enrich_document(entity, normalize_document(dict(row)))
                docs[d[config.id_field]] = d
            return docs


def live_docs(os_url: str, index: str, ids: list[str]) -> dict[str, dict]:
    out = {}
    for i in range(0, len(ids), 1000):
        r = http(os_url, "POST", f"/{index}/_mget", {"ids": ids[i:i + 1000]})
        for d in r["docs"]:
            if d.get("found"):
                # bgc_facets stores nulls; normalize_document drops them.
                out[d["_id"]] = {k: v for k, v in d["_source"].items() if v is not None}
    return out


def same(a, b) -> bool:
    if isinstance(a, float) or isinstance(b, float):
        try:
            return abs(float(a) - float(b)) < 1e-9
        except (TypeError, ValueError):
            return False
    return a == b


def bulk_delete(os_url: str, index: str, ids: list[str]) -> None:
    for i in range(0, len(ids), 5000):
        lines = [json.dumps({"delete": {"_index": index, "_id": k}}) for k in ids[i:i + 5000]]
        r = http(os_url, "POST", "/_bulk", "\n".join(lines) + "\n", ndjson=True)
        bad = [it for it in r["items"] if it["delete"].get("status") not in (200, 404)]
        if bad:
            raise SystemExit(f"bulk delete errors, first: {bad[0]}")


def delete_ids(os_url, entity, alias, src, dst, ids, apply) -> int:
    live = set()
    for i in range(0, len(ids), 1000):
        r = http(os_url, "POST", f"/{src}/_mget?_source=false", {"ids": ids[i:i + 1000]})
        live |= {d["_id"] for d in r["docs"] if d.get("found")}
    missing = len(ids) - len(live)
    src_n = http(os_url, "GET", f"/{src}/_count")["count"]
    print(f"delete: {len(ids):,} ids, {len(live):,} live in {src} ({missing:,} not there); "
          f"{src_n:,} -> {src_n - len(live):,}")
    if missing:
        print("REFUSING: some ids are not in the live index -- wrong list?", file=sys.stderr)
        return 1
    if not apply:
        print("dry run: nothing written")
        return 0
    clone_index(os_url, src, dst)
    bulk_delete(os_url, dst, sorted(live))
    http(os_url, "POST", f"/{dst}/_refresh")
    dst_n = http(os_url, "GET", f"/{dst}/_count")["count"]
    left = 0
    for i in range(0, len(ids), 1000):
        r = http(os_url, "POST", f"/{dst}/_mget?_source=false", {"ids": ids[i:i + 1000]})
        left += sum(1 for d in r["docs"] if d.get("found"))
    print(f"deleted; {dst} count {dst_n:,} (expected {src_n - len(live):,}); still present {left:,}")
    if left or dst_n != src_n - len(live):
        print("DO NOT PROMOTE", file=sys.stderr)
        return 1
    print(f"Promote: swap {alias} from {src} to {dst}")
    return 0


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


def main(argv: list[str]) -> int:
    args = [a for a in argv if not a.startswith("--")]
    apply = "--apply" in argv
    os_url = argv[argv.index("--os") + 1] if "--os" in argv else "http://localhost:9200"
    allow_drop = {argv[i + 1] for i, a in enumerate(argv) if a == "--allow-drop"}
    args = [a for a in args if a != os_url and a not in allow_drop]
    if len(args) != 3 or args[0] not in ALIASES:
        print(__doc__, file=sys.stderr)
        return 2
    entity, ids_path, dst = args
    ids = sorted({line.strip() for line in open(ids_path) if line.strip()})
    alias = ALIASES[entity]
    src = sorted(http(os_url, "GET", f"/_alias/{alias}"))[0]
    print(f"{entity}: {len(ids):,} ids; live {alias} = {src}; destination {dst}")

    if "--delete" in argv:
        return delete_ids(os_url, entity, alias, src, dst, ids, apply)

    new = regenerate(entity, ids)
    old = live_docs(os_url, src, ids)
    print(f"regenerated {len(new):,}; live {len(old):,}")
    to_delete: list[str] = []
    if set(new) != set(old):
        print(f"  ids regenerated but not live: {len(set(new) - set(old)):,}; "
              f"live but not regenerated: {len(set(old) - set(new)):,}")
        if set(old) - set(new):
            if "--delete-missing" not in argv:
                print("REFUSING: live documents the projection no longer produces "
                      "(--delete-missing if that is the intended change)", file=sys.stderr)
                return 1
            to_delete = sorted(set(old) - set(new))
            print(f"  will DELETE {len(to_delete):,} documents the projection no longer produces")

    changed, added, dropped = collections.Counter(), collections.Counter(), collections.Counter()
    docs_changed = 0
    for key, doc in new.items():
        before = old.get(key, {})
        fields = FACET_FIELDS if entity == "facets" else set(doc) | set(before)
        touched = False
        for f in fields:
            if f in doc and f in before:
                if not same(doc[f], before[f]):
                    changed[f] += 1
                    touched = True
            elif f in doc:
                added[f] += 1
                touched = True
            elif f in before:
                dropped[f] += 1
                touched = True
        docs_changed += touched
    print(f"documents that change: {docs_changed:,}")
    for label, counter in (("changed", changed), ("added", added), ("dropped", dropped)):
        for f, n in sorted(counter.items(), key=lambda kv: -kv[1]):
            print(f"  {label:8s} {f:36s} {n:,}")
    bad = {f for f in dropped if f not in allow_drop}
    if bad:
        print(f"REFUSING: would drop {sorted(bad)} from live documents "
              "(--allow-drop <field> if that is the intended change)", file=sys.stderr)
        return 1
    if not apply:
        print("dry run: nothing written")
        return 0

    clone_index(os_url, src, dst)

    lines, n = [], 0
    for key, doc in new.items():
        if entity == "facets":
            lines.append(json.dumps({"update": {"_index": dst, "_id": key}}))
            lines.append(json.dumps({"doc": doc}, default=str))
        else:
            lines.append(json.dumps({"index": {"_index": dst, "_id": key}}))
            lines.append(json.dumps(doc, default=str))
        n += 1
        if len(lines) >= 2000 or n == len(new):
            r = http(os_url, "POST", "/_bulk", "\n".join(lines) + "\n", ndjson=True)
            if r.get("errors"):
                first = next(i for i in r["items"] if list(i.values())[0].get("error"))
                raise SystemExit(f"bulk errors, first: {first}")
            lines = []
    bulk_delete(os_url, dst, to_delete)
    http(os_url, "POST", f"/{dst}/_refresh")

    after = live_docs(os_url, dst, ids)
    wrong = 0
    for key, doc in new.items():
        got = after.get(key, {})
        check = doc.keys()
        wrong += any(not same(got.get(f), doc[f]) for f in check)
    gone = [k for k in to_delete if k in after]
    src_n = http(os_url, "GET", f"/{src}/_count")["count"]
    dst_n = http(os_url, "GET", f"/{dst}/_count")["count"]
    expected = src_n - len(to_delete) + len(set(new) - set(old))
    print(f"wrote {len(new):,}; deleted {len(to_delete):,}; re-read mismatches {wrong:,}; "
          f"still present after delete {len(gone):,}; count {src} {src_n:,} -> {dst} {dst_n:,} "
          f"(expected {expected:,})")
    if wrong or gone or dst_n != expected:
        print("DO NOT PROMOTE", file=sys.stderr)
        return 1
    print("Promote with (source scripts/opensearch/oscurl.sh):\n  oscurl -XPOST " + os_url + "/_aliases -H 'Content-Type: application/json' "
          f"-d '{{\"actions\":[{{\"remove\":{{\"index\":\"{src}\",\"alias\":\"{alias}\"}}}},"
          f"{{\"add\":{{\"index\":\"{dst}\",\"alias\":\"{alias}\"}}}}]}}'")
    return 0


if __name__ == "__main__":
    install_opensearch_auth()
    sys.exit(main(sys.argv[1:]))
