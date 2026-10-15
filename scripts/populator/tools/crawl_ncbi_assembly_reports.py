#!/usr/bin/env python3
"""Crawl NCBI Datasets assembly reports for a list of assembly accessions.

Fetches `assembly_info.genome_notes` and the BioSample title -- how a genome was
derived -- for `backfill_omd_geno_source_type`. Only fills a cache; parsing is a
separate step.

Accessions are sorted and de-duplicated so batch N is stable and a cached batch
is skipped on resume. NCBI allows 10 req/s with ``NCBI_API_KEY``, 3/s without.

Usage:
    NCBI_API_KEY=... scripts/populator/.venv/bin/python \
      -m scripts.populator.tools.crawl_ncbi_assembly_reports \
        --ids /data/bgc-atlas/.../omd_geno_accessions.txt \
        --cache-dir /data/bgc-atlas/.../omd_geno_assembly_cache \
        [--batch-size 200] [--limit N]
"""
import argparse
import json
import os
import threading
import time

import requests

DATASETS_REPORT = "https://api.ncbi.nlm.nih.gov/datasets/v2alpha/genome/dataset_report"


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
        if acc:
            seen.add(acc)
    return sorted(seen)


def _fetch(session, accessions, api_key, limiter, retries=4):
    body = {
        "accessions": accessions,
        # page_size above the batch size so a batch never needs next_page_token.
        "page_size": len(accessions) + 1,
    }
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if api_key:
        headers["api-key"] = api_key
    delay = 2.0
    for _ in range(retries):
        limiter.wait()
        try:
            r = session.post(DATASETS_REPORT, json=body, headers=headers, timeout=180)
            if r.status_code == 200:
                payload = r.json()
                # An all-unknown batch has no `reports` key, so accept total_count too.
                if "reports" in payload or "total_count" in payload:
                    return payload
        except (requests.RequestException, ValueError):
            pass
        time.sleep(delay)
        delay *= 2
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ids", required=True, help="file of assembly accessions, one per line")
    ap.add_argument("--cache-dir", required=True)
    ap.add_argument("--batch-size", type=int, default=200)
    ap.add_argument("--workers", type=int, default=4,
                    help="concurrent fetchers (overlap latency; rate stays capped)")
    ap.add_argument("--limit", type=int, default=0, help="stop after N batches (smoke test)")
    args = ap.parse_args()

    api_key = os.environ.get("NCBI_API_KEY")
    limiter = RateLimiter(0.105 if api_key else 0.34)
    print(f"API key: {'yes' if api_key else 'NO (3 req/s)'} | workers: {args.workers}",
          flush=True)

    ids = _load_ids(args.ids)
    os.makedirs(args.cache_dir, exist_ok=True)
    nbatch = (len(ids) + args.batch_size - 1) // args.batch_size
    if args.limit:
        nbatch = min(nbatch, args.limit)
    print(f"{len(ids)} accessions -> {nbatch} batches of {args.batch_size}", flush=True)

    tls = threading.local()

    def _session():
        s = getattr(tls, "s", None)
        if s is None:
            s = tls.s = requests.Session()
        return s

    todo, cached = [], 0
    for i in range(nbatch):
        path = os.path.join(args.cache_dir, f"batch_{i:05d}.json")
        if os.path.exists(path) and os.path.getsize(path) > 0:
            cached += 1
        else:
            todo.append(i)
    print(f"already cached: {cached} | to fetch: {len(todo)}", flush=True)

    failed = []

    def process(i):
        batch = ids[i * args.batch_size:(i + 1) * args.batch_size]
        payload = _fetch(_session(), batch, api_key, limiter)
        if payload is None:
            return i, False
        path = os.path.join(args.cache_dir, f"batch_{i:05d}.json")
        # Write-then-rename so an interrupted run never leaves a truncated batch.
        tmp = f"{path}.tmp"
        with open(tmp, "w") as fh:
            json.dump(payload, fh)
        os.replace(tmp, path)
        return i, True

    from concurrent.futures import ThreadPoolExecutor, as_completed
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(process, i) for i in todo]
        for n, fut in enumerate(as_completed(futures), 1):
            i, ok = fut.result()
            if not ok:
                failed.append(i)
            if n % 10 == 0 or n == len(todo):
                print(f"  {n}/{len(todo)} batches", flush=True)

    if failed:
        print(f"FAILED batches (re-run to retry): {sorted(failed)}")
        return 1
    print("all batches cached")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
