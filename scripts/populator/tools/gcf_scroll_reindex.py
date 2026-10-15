#!/usr/bin/env python3
"""Scroll the live bgc_browse index, replace its family fields, bulk-INDEX into a new one.

After a re-clustering every bgc_browse document's
`gcf_id`, `gcf_name` and `distance` name the replaced clustering; nothing else in the document
depends on it. A corpus rebuild of 16M documents takes hours; this scrolls the live index (sliced)
and replaces only those three fields, so in-place backfills survive.

The three fields are dropped from every document and set only from the map: a BGC with no primary
family in the new clustering must not keep its old one.

Usage:
  gcf_scroll_reindex.py <src-index> <dst-index> <map.tsv> [scroll_size] [bulk_chunk] [--slices=N]
  map.tsv: bgc_id <TAB> gcf_id <TAB> gcf_name <TAB> distance, one row per PRIMARY membership:
    psql -d bgc_atlas_v2 -c "\\copy (SELECT bg.bgc_id, g.id, g.name, bg.distance FROM bgc_gcf bg
      JOIN gcfs g ON g.id = bg.gcf_id WHERE bg.is_primary) TO 'map.tsv'"
Create the destination first (browse_index_lifecycle.py create bgcs <version>), then promote with
browse_index_lifecycle.py, --expected-count = the src doc count.

stdlib only.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

OS_URL = os.environ.get("OPENSEARCH_URL", "http://localhost:9200").rstrip("/")
SCROLL_TTL = "30m"


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


def req(method, path, body=None, timeout=300):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(OS_URL + path, data=data,
                               headers={"Content-Type": "application/json"} if data else {},
                               method=method)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(r, timeout=timeout) as resp:
                return json.loads(resp.read())
        except (urllib.error.URLError, TimeoutError):
            if attempt == 3:
                raise
            time.sleep(2 * (attempt + 1))


def bulk(lines, timeout=300):
    payload = "".join(lines).encode()
    r = urllib.request.Request(OS_URL + "/_bulk", data=payload,
                               headers={"Content-Type": "application/x-ndjson"},
                               method="POST")
    for attempt in range(4):
        try:
            with urllib.request.urlopen(r, timeout=timeout) as resp:
                return json.loads(resp.read())
        except (urllib.error.URLError, TimeoutError):
            if attempt == 3:
                raise
            time.sleep(2 * (attempt + 1))


def load_map(path):
    families = {}
    with open(path) as fh:
        for line in fh:
            p = line.rstrip("\n").split("\t")
            if len(p) >= 4:
                families[p[0]] = (p[1], p[2], float(p[3]) if p[3] not in ("", "\\N") else None)
    return families


def set_family(doc, bgc_id, families):
    """Replace doc's gcf_id/gcf_name/distance from the map; return False when it has no family now."""
    for field in ("gcf_id", "gcf_name", "distance"):
        doc.pop(field, None)
    hit = families.get(bgc_id)
    if hit is None:
        return False
    doc["gcf_id"], doc["gcf_name"], doc["distance"] = hit
    return True


OFFSETS = {}


def scroll_slice(src, dst, scroll_size, bulk_chunk, slice_id=None, slices=1):
    """Scroll one slice of src (all of it when slices == 1), bulk-INDEX into dst. Returns counts."""
    t0 = time.time()
    body = {"size": scroll_size, "query": {"match_all": {}}}
    if slices > 1:
        body["slice"] = {"id": slice_id, "max": slices}
    resp = req("POST", f"/{src}/_search?scroll={SCROLL_TTL}", body)
    sid = resp["_scroll_id"]
    seen = indexed = errors = unplaced = 0
    first_errors = []
    lines = []
    tag = f"[slice {slice_id}/{slices}] " if slices > 1 else ""

    def flush():
        nonlocal indexed, errors, lines
        if not lines:
            return
        res = bulk(lines)
        if res.get("errors"):
            for item in res["items"]:
                err = item.get("index", {}).get("error")
                if err:
                    errors += 1
                    if len(first_errors) < 5:
                        first_errors.append(err)
        indexed += len(lines) // 2
        lines = []

    while True:
        hits = resp["hits"]["hits"]
        if not hits:
            break
        for h in hits:
            doc = h["_source"]
            seen += 1
            if not set_family(doc, h["_id"], OFFSETS):
                unplaced += 1
            lines.append(json.dumps({"index": {"_index": dst, "_id": h["_id"]}}) + "\n")
            lines.append(json.dumps(doc) + "\n")
            if len(lines) >= bulk_chunk * 2:
                flush()
        if seen % 500000 < scroll_size:
            el = time.time() - t0
            print(f"  {tag}{seen:,} scrolled  {unplaced:,} unclustered  "
                  f"{errors:,} errors  {el:.0f}s", flush=True)
        resp = req("POST", "/_search/scroll",
                   {"scroll": SCROLL_TTL, "scroll_id": sid})
        sid = resp["_scroll_id"]
    flush()
    req("DELETE", "/_search/scroll", {"scroll_id": [sid]})
    return seen, indexed, unplaced, errors, first_errors


def _slice_worker(job):
    return scroll_slice(*job)


def main():
    global OFFSETS
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    src, dst, index_path = args[0], args[1], args[2]
    scroll_size = int(args[3]) if len(args) > 3 else 5000
    bulk_chunk = int(args[4]) if len(args) > 4 else 5000
    # --slices N: N sliced scrolls in N processes (one scroll took ~70 min for bgc_browse). The offset
    # table is loaded once before the fork and shared copy-on-write.
    slices = next((int(a.split("=", 1)[1]) for a in sys.argv[1:] if a.startswith("--slices=")), 1)

    print(f"loading the family map from {index_path} ...", flush=True)
    t0 = time.time()
    OFFSETS = load_map(index_path)
    print(f"  {len(OFFSETS):,} clustered BGCs in {time.time()-t0:.0f}s", flush=True)

    t0 = time.time()
    if slices > 1:
        import multiprocessing as mp
        jobs = [(src, dst, scroll_size, bulk_chunk, i, slices) for i in range(slices)]
        with mp.get_context("fork").Pool(slices) as pool:
            results = pool.map(_slice_worker, jobs)
    else:
        results = [scroll_slice(src, dst, scroll_size, bulk_chunk)]
    seen = sum(r[0] for r in results)
    indexed = sum(r[1] for r in results)
    unplaced = sum(r[2] for r in results)
    errors = sum(r[3] for r in results)
    first_errors = [e for r in results for e in r[4]][:5]
    print(f"DONE seen={seen:,} indexed={indexed:,} unclustered={unplaced:,} "
          f"errors={errors:,} in {time.time()-t0:.0f}s ({slices} slice(s))", flush=True)
    for err in first_errors:
        print(f"  error: {json.dumps(err)[:300]}", flush=True)
    return 1 if errors else 0


if __name__ == "__main__":
    install_opensearch_auth()
    raise SystemExit(main())
