"""Crawl NCBI BioProject efetch XML for a list of BioProject accessions, caching raw
XML to disk. Same resumable batching and rate limiter as crawl_ncbi_biosample.
Parsing is a separate step (parse_bioproject / backfill_gtdb_studies).

Usage:
    NCBI_API_KEY=... NCBI_EMAIL=you@x.org \
    scripts/populator/.venv/bin/python -m scripts.populator.tools.crawl_ncbi_bioproject \
        --ids /data/bgc-atlas/.../gtdb_bioprojects.txt --cache-dir /data/bgc-atlas/.../bioproject_cache
"""
import argparse
import os
import sys
import threading
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

from scripts.populator.tools.crawl_ncbi_biosample import RateLimiter, _load_ids

EFETCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"


def _fetch(session, ids, api_key, email, limiter, retries=4):
    import time
    data = {"db": "bioproject", "id": ",".join(ids), "tool": "bgc-atlas"}
    if api_key:
        data["api_key"] = api_key
    if email:
        data["email"] = email
    delay = 2.0
    for _ in range(retries):
        limiter.wait()
        try:
            r = session.post(EFETCH, data=data, timeout=120)
            if r.status_code == 200 and b"<DocumentSummary" in r.content:
                try:
                    ET.fromstring(r.content)      # reject truncated/partial bodies
                    return r.content
                except ET.ParseError:
                    pass
        except requests.RequestException:
            pass
        time.sleep(delay)
        delay *= 2
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ids", required=True)
    ap.add_argument("--cache-dir", required=True)
    ap.add_argument("--batch-size", type=int, default=200)
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()

    api_key = os.environ.get("NCBI_API_KEY")
    email = os.environ.get("NCBI_EMAIL")
    limiter = RateLimiter(0.105 if api_key else 0.34)
    print(f"API key: {'yes' if api_key else 'NO (3 req/s)'} | workers: {args.workers}", flush=True)

    ids = _load_ids(args.ids)
    os.makedirs(args.cache_dir, exist_ok=True)
    nbatch = (len(ids) + args.batch_size - 1) // args.batch_size
    print(f"{len(ids)} bioprojects -> {nbatch} batches of {args.batch_size}", flush=True)

    tls = threading.local()

    def _session():
        s = getattr(tls, "s", None)
        if s is None:
            s = tls.s = requests.Session()
        return s

    todo, done = [], 0
    for i in range(nbatch):
        path = os.path.join(args.cache_dir, f"bp_{i:05d}.xml")
        if os.path.exists(path) and os.path.getsize(path) > 0:
            done += 1
        else:
            todo.append(i)
    print(f"already cached: {done} | to fetch: {len(todo)}", flush=True)

    def process(i):
        batch = ids[i * args.batch_size:(i + 1) * args.batch_size]
        content = _fetch(_session(), batch, api_key, email, limiter)
        if content is None:
            return "failed", i
        path = os.path.join(args.cache_dir, f"bp_{i:05d}.xml")
        tmp = path + f".tmp{i}"
        with open(tmp, "wb") as fh:
            fh.write(content)
        os.replace(tmp, path)
        return "fetched", i

    fetched = failed = 0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        for fut in as_completed([ex.submit(process, i) for i in todo]):
            status, i = fut.result()
            if status == "failed":
                failed += 1
                print(f"  batch {i}: FAILED", flush=True)
            else:
                fetched += 1
    print(f"done: cached_already={done} fetched={fetched} failed={failed}", flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
