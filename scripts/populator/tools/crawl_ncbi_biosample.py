"""Crawl NCBI BioSample efetch XML for a list of accessions, caching raw XML to
``<cache>/batch_<NNNNN>.xml``.

Accessions are sorted and de-duplicated so batch N is stable and a cached batch is
skipped on resume. NCBI allows 10 req/s with ``NCBI_API_KEY``, 3/s without.
Parsing is a separate step (backfill_gtdb_biosample).

Usage:
    NCBI_API_KEY=... NCBI_EMAIL=you@x.org \
    scripts/populator/.venv/bin/python -m scripts.populator.tools.crawl_ncbi_biosample \
        --ids /data/bgc-atlas/.../gtdb_biosamples.txt \
        --cache-dir /data/bgc-atlas/.../biosample_cache \
        [--batch-size 250] [--limit N]
"""
import argparse
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

EFETCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"


class RateLimiter:
    """Hands out request slots at least ``min_interval`` apart across threads;
    the wait happens outside the lock."""

    def __init__(self, min_interval):
        self.min_interval = min_interval
        self._lock = threading.Lock()
        self._next_at = 0.0

    def wait(self):
        with self._lock:
            t = max(time.monotonic(), self._next_at)
            self._next_at = t + self.min_interval
        delay = t - time.monotonic()
        if delay > 0:
            time.sleep(delay)


def _load_ids(path):
    seen = set()
    for line in open(path):
        acc = line.strip()
        if acc and acc not in seen:
            seen.add(acc)
    return sorted(seen)


def _fetch(session, ids, api_key, email, limiter, retries=4):
    data = {"db": "biosample", "id": ",".join(ids), "rettype": "xml", "tool": "bgc-atlas"}
    if api_key:
        data["api_key"] = api_key
    if email:
        data["email"] = email
    delay = 2.0
    for attempt in range(retries):
        limiter.wait()
        try:
            r = session.post(EFETCH, data=data, timeout=120)
            if r.status_code == 200 and b"<BioSample" in r.content:
                return r.content
        except requests.RequestException:
            pass
        time.sleep(delay)
        delay *= 2
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ids", required=True, help="file of BioSample accessions, one per line")
    ap.add_argument("--cache-dir", required=True)
    ap.add_argument("--batch-size", type=int, default=250)
    ap.add_argument("--workers", type=int, default=6,
                    help="concurrent fetchers (overlap response latency; rate stays capped)")
    ap.add_argument("--limit", type=int, default=0, help="stop after N batches (smoke test)")
    args = ap.parse_args()

    api_key = os.environ.get("NCBI_API_KEY")
    email = os.environ.get("NCBI_EMAIL")
    min_interval = 0.105 if api_key else 0.34   # 10/s with key, ~3/s without
    limiter = RateLimiter(min_interval)
    print(f"API key: {'yes' if api_key else 'NO (3 req/s)'} | email: {email or '(unset)'} "
          f"| workers: {args.workers}", flush=True)

    ids = _load_ids(args.ids)
    os.makedirs(args.cache_dir, exist_ok=True)
    nbatch = (len(ids) + args.batch_size - 1) // args.batch_size
    if args.limit:
        nbatch = min(nbatch, args.limit)
    print(f"{len(ids)} accessions -> {nbatch} batches of {args.batch_size}", flush=True)

    # requests.Session isn't guaranteed thread-safe.
    tls = threading.local()

    def _session():
        s = getattr(tls, "s", None)
        if s is None:
            s = tls.s = requests.Session()
        return s

    todo = []
    done = 0
    for i in range(nbatch):
        path = os.path.join(args.cache_dir, f"batch_{i:05d}.xml")
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
        path = os.path.join(args.cache_dir, f"batch_{i:05d}.xml")
        tmp = path + f".tmp{i}"
        with open(tmp, "wb") as fh:
            fh.write(content)
        os.replace(tmp, path)
        return "fetched", i

    fetched = failed = 0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = [ex.submit(process, i) for i in todo]
        for fut in as_completed(futures):
            status, i = fut.result()
            if status == "failed":
                failed += 1
                print(f"  batch {i}: FAILED after retries", flush=True)
            else:
                fetched += 1
                if fetched % 50 == 0:
                    print(f"  fetched {fetched} / {len(todo)}", flush=True)
    print(f"done: cached_already={done} fetched={fetched} failed={failed}", flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
