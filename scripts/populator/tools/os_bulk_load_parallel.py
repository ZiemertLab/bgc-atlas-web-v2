#!/usr/bin/env python3
"""Parallel bulk-load an NDJSON(.gz) corpus into OpenSearch (stdlib only).

Posts _bulk chunks from a bounded thread pool. id-field defaults to ``bgc_id``;
browse corpora pass ``gcf_id`` or ``sample_id``.

Usage: os_bulk_load_parallel.py <ndjson[.gz]> <index-url> [chunk] [concurrency] [id-field]
"""
import gzip
import json
import os
import sys
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor


def bulk_error_records(response: dict, document_ids: list[str]) -> list[dict]:
    records = []
    for document_id, item in zip(document_ids, response.get("items", [])):
        outcome = item.get("index", {})
        if outcome.get("error"):
            records.append({"id": document_id, "error": outcome["error"]})
    return records


def post(bulk_url: str, payload: bytes, document_ids: list[str]) -> list[dict]:
    req = urllib.request.Request(
        bulk_url, data=payload,
        headers={"Content-Type": "application/x-ndjson"}, method="POST",
    )
    with urllib.request.urlopen(req) as r:
        resp = json.loads(r.read())
    return bulk_error_records(resp, document_ids) if resp.get("errors") else []


def bulk_action(document: dict, id_field: str) -> dict:
    document_id = document.get(id_field)
    if not document_id:
        raise ValueError(f"document missing required id field: {id_field}")
    return {"index": {"_id": str(document_id)}}


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
    corpus, index_url = sys.argv[1], sys.argv[2].rstrip("/")
    chunk = int(sys.argv[3]) if len(sys.argv) > 3 else 5000
    conc = int(sys.argv[4]) if len(sys.argv) > 4 else 12
    id_field = sys.argv[5] if len(sys.argv) > 5 else "bgc_id"
    bulk_url = index_url + "/_bulk"
    error_log = os.environ.get("OS_BULK_ERROR_LOG")
    if error_log:
        open(error_log, "w").close()

    state = {"n": 0, "errors": 0}
    lock = threading.Lock()
    t0 = time.time()

    def worker(payload: bytes, count: int, document_ids: list[str]):
        errors = post(bulk_url, payload, document_ids)
        with lock:
            state["n"] += count
            state["errors"] += len(errors)
            if errors and error_log:
                with open(error_log, "a") as out:
                    for error in errors:
                        out.write(json.dumps(error))
                        out.write("\n")
            if state["n"] % 500000 < chunk:
                print(f"  {state['n']} docs ({state['n']/(time.time()-t0):.0f}/s) "
                      f"errs={state['errors']}", flush=True)

    op = gzip.open if corpus.endswith(".gz") else open
    ex = ThreadPoolExecutor(max_workers=conc)
    futs = []
    buf = []
    ids = []
    cnt = 0
    for line in op(corpus, "rt"):
        document = json.loads(line)
        buf.append(json.dumps(bulk_action(document, id_field)))
        buf.append(line.rstrip("\n"))
        ids.append(str(document[id_field]))
        cnt += 1
        if cnt >= chunk:
            futs.append(ex.submit(worker, ("\n".join(buf) + "\n").encode(), cnt, ids))
            buf, ids, cnt = [], [], 0
            if len(futs) >= conc * 4:          # backpressure
                for f in futs[:conc * 2]:
                    f.result()
                futs = futs[conc * 2:]
    if buf:
        futs.append(ex.submit(worker, ("\n".join(buf) + "\n").encode(), cnt, ids))
    for f in futs:
        f.result()
    ex.shutdown()
    print(f"DONE indexed={state['n']} errors={state['errors']} "
          f"in {(time.time()-t0)/60:.1f} min", flush=True)
    if state["errors"]:
        if error_log:
            print(f"error details: {error_log}", flush=True)
        sys.exit(1)


if __name__ == "__main__":
    install_opensearch_auth()
    main()
