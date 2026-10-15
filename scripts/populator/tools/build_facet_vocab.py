#!/usr/bin/env python3
"""Build the facet-vocabulary index for fast BGC-property autocomplete.

Precomputes the distinct values and counts of every keyword facet into a small
edge-ngram index, since a live terms-agg autocomplete over 16.5M docs takes ~4.7s.
Re-run after a corpus refresh.

``bgc_facet_vocab`` is an alias (OpenSearch rejects DELETE/PUT on it), so each run
builds ``bgc_facet_vocab_v<N>`` and swaps the alias only if no field lost terms
versus the current version; --force overrides. The previous version is kept for
rollback.

Usage:
  OPENSEARCH_URL=http://... python3 build_facet_vocab.py [--version v7]
                                                         [--no-promote] [--force]
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

OS_URL = os.environ.get("OPENSEARCH_URL", "http://localhost:9200")
SRC = os.environ.get("OPENSEARCH_INDEX", "bgc_facets")
VOCAB = os.environ.get("OPENSEARCH_VOCAB_INDEX", "bgc_facet_vocab")

# Excludes gcf_id/bgc_id: uuid-like, no autocomplete value.
FIELDS = [
    "product", "product_category", "candidate_kind", "detection_rules",
    "tax_domain", "tax_phylum", "tax_class", "tax_order", "tax_family",
    "tax_genus", "tax_species", "data_source",
    "pfam", "pfam_desc", "tigrfam", "tigrfam_desc", "smcog", "smcog_desc",
    "go_terms", "antismash_domains",
    "substrates", "monomers", "module_signatures", "stachelhaus_codes",
    "at_specificity", "kr_stereochemistry",
    "pks_t2_class", "pks_t2_starter", "pks_t2_elongation",
    "terpene_products", "terpene_domains",
    "ripp_class", "ripp_subclass", "ripp_modifications", "comparippson_hits",
    "knowncluster_hits", "knowncluster_compounds", "knowncluster_top_compound",
    "clusterblast_hits", "subcluster_hits", "mibig_comparison_top",
    "tfbs_regulators",
    "sample_type", "sample_name", "biome", "env_feature", "env_material",
    "env_package", "host", "geolocation", "gold_ecosystem",
]

MAPPING = {
    "settings": {
        "index": {"number_of_shards": 1, "number_of_replicas": 0, "refresh_interval": "-1"},
        "analysis": {
            # Splits on non-alphanumerics ("g__Streptomyces" -> Streptomyces).
            "tokenizer": {
                "edge_tok": {"type": "edge_ngram", "min_gram": 2, "max_gram": 20,
                             "token_chars": ["letter", "digit"]}
            },
            "analyzer": {
                "edge": {"type": "custom", "tokenizer": "edge_tok", "filter": ["lowercase"]},
                "edge_search": {"type": "custom", "tokenizer": "standard", "filter": ["lowercase"]},
            },
        },
    },
    "mappings": {"properties": {
        "field": {"type": "keyword"},
        "value": {"type": "keyword",
                  "fields": {"prefix": {"type": "text", "analyzer": "edge",
                                        "search_analyzer": "edge_search"}}},
        "count": {"type": "long"},
    }},
}


def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(f"{OS_URL}{path}", data=data, method=method,
                               headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(r) as resp:
            # HEAD returns no body, and json.loads('') raises.
            return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def bulk(index, lines):
    payload = ("\n".join(lines) + "\n").encode()
    r = urllib.request.Request(f"{OS_URL}/{index}/_bulk", data=payload, method="POST",
                               headers={"Content-Type": "application/x-ndjson"})
    with urllib.request.urlopen(r) as resp:
        res = json.loads(resp.read())
    return sum(1 for it in res.get("items", []) if it.get("index", {}).get("error"))


_VERSION_RE = re.compile(rf"^{re.escape(VOCAB)}_v(\d+)$")


def alias_indices(alias):
    code, resp = req("GET", f"/_alias/{alias}")
    return [] if code == 404 else sorted(resp)


def is_alias(name):
    return bool(alias_indices(name))


def existing_versions():
    code, resp = req("GET", f"/{VOCAB}_v*/_alias")
    if code >= 300:
        return []
    out = []
    for index in resp:
        m = _VERSION_RE.match(index)
        if m:
            out.append(int(m.group(1)))
    return sorted(out)


def next_version():
    versions = existing_versions()
    return f"v{(max(versions) + 1) if versions else 1}"


def per_field_counts(index):
    """{field: distinct term count}; the bucket size must exceed len(FIELDS) or the diff lies."""
    code, resp = req("POST", f"/{index}/_search", {
        "size": 0,
        "aggs": {"f": {"terms": {"field": "field", "size": 500}}},
    })
    if code >= 300:
        return {}
    buckets = resp.get("aggregations", {}).get("f", {}).get("buckets", [])
    return {b["key"]: b["doc_count"] for b in buckets}


def report_diff(old_counts, new_counts):
    """Print the per-field diff; return the fields that lost terms."""
    shrunk = []
    print(f"\n{'field':<28}{'old':>10}{'new':>10}{'delta':>12}")
    print("-" * 60)
    for field in sorted(set(old_counts) | set(new_counts)):
        old = old_counts.get(field, 0)
        new = new_counts.get(field, 0)
        delta = new - old
        mark = ""
        if delta < 0:
            shrunk.append((field, old, new))
            mark = "  <-- LOST"
        elif field not in old_counts:
            mark = "  (new)"
        print(f"{field:<28}{old:>10,}{new:>10,}{delta:>+12,}{mark}")
    return shrunk


def promote(alias, index):
    actions = [{"remove": {"index": current, "alias": alias}} for current in alias_indices(alias)]
    actions.append({"add": {"index": index, "alias": alias}})
    code, resp = req("POST", "/_aliases", {"actions": actions})
    if code >= 300:
        raise RuntimeError(f"alias swap failed ({code}): {resp}")


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


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--version", help=f"target index suffix, e.g. v7 (default: next after existing)")
    ap.add_argument("--no-promote", action="store_true",
                    help="build and diff, but leave the alias where it is")
    ap.add_argument("--force", action="store_true",
                    help="promote even though a field lost terms")
    args = ap.parse_args()

    t0 = time.time()
    version = args.version or next_version()
    if not re.fullmatch(r"v\d+", version):
        print(f"bad --version {version!r}: expected v<N>", file=sys.stderr); sys.exit(2)
    target = f"{VOCAB}_{version}"

    if is_alias(target):
        print(f"{target} is an alias, not an index -- refusing to build into it",
              file=sys.stderr)
        sys.exit(2)
    if req("HEAD", f"/{target}")[0] == 200:
        print(f"{target} already exists -- pass a different --version", file=sys.stderr)
        sys.exit(2)

    serving = alias_indices(VOCAB)
    old_counts = per_field_counts(serving[0]) if serving else {}
    print(f"building {target} (alias {VOCAB} currently serves "
          f"{serving[0] if serving else '(nothing)'})", flush=True)

    code, resp = req("PUT", f"/{target}", MAPPING)
    if code >= 300:
        print("create failed:", resp); sys.exit(1)
    total = 0
    for field in FIELDS:
        after = None
        n = 0
        while True:
            comp = {"size": 5000, "sources": [{"t": {"terms": {"field": field}}}]}
            if after:
                comp["after"] = after
            code, r = req("POST", f"/{SRC}/_search",
                          {"size": 0, "aggs": {"v": {"composite": comp}}})
            agg = r.get("aggregations", {}).get("v", {})
            buckets = agg.get("buckets", [])
            if not buckets:
                break
            lines = []
            for b in buckets:
                val = b["key"]["t"]
                if val is None:
                    continue
                # auto _id (index is recreated each run); some values exceed the 512B _id limit
                lines.append(json.dumps({"index": {}}))
                lines.append(json.dumps({"field": field, "value": val, "count": b["doc_count"]}))
            if lines:
                bulk(target, lines)
            n += len(buckets)
            after = agg.get("after_key")
            if not after:
                break
        total += n
        print(f"  {field}: {n} distinct", flush=True)
    req("PUT", f"/{target}/_settings", {"index": {"refresh_interval": "1s"}})
    req("POST", f"/{target}/_refresh")
    _, cnt = req("GET", f"/{target}/_count")
    print(f"\nbuilt {total} vocab terms across {len(FIELDS)} fields "
          f"({target} _count={cnt.get('count')}) in {(time.time()-t0)/60:.1f} min")

    shrunk = report_diff(old_counts, per_field_counts(target))

    if args.no_promote:
        print(f"\n--no-promote: {VOCAB} still serves "
              f"{serving[0] if serving else '(nothing)'}. Promote with:\n"
              f"  oscurl -XPOST $OPENSEARCH_URL/_aliases -H 'Content-Type: application/json' \\\n"
              f"    -d '{json.dumps({'actions': [{'add': {'index': target, 'alias': VOCAB}}]})}'")
        return

    if shrunk and not args.force:
        print(f"\nREFUSING TO PROMOTE: {len(shrunk)} field(s) lost terms:", file=sys.stderr)
        for field, old, new in shrunk:
            print(f"  {field}: {old:,} -> {new:,}", file=sys.stderr)
        print(f"\n{target} is built and left in place; {VOCAB} still serves "
              f"{serving[0] if serving else '(nothing)'}.\n"
              "A field that shrank usually means it was renamed or emptied upstream, which "
              "would swap in a vocab that autocompletes nothing for it. Re-run with --force "
              "if the loss is a real corpus edit.", file=sys.stderr)
        sys.exit(1)

    if shrunk:
        print(f"\n--force: promoting despite {len(shrunk)} shrunken field(s).")
    promote(VOCAB, target)
    print(f"promoted {VOCAB} -> {target}"
          + (f" (was {serving[0]}, kept for rollback)" if serving else ""))


if __name__ == "__main__":
    install_opensearch_auth()
    main()
