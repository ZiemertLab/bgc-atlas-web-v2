"""Concurrent detail-fetch into one ``<entity_type>.jsonl.gz`` bundle, used by every phase.

Keys already "ok" in the resume log or present in the bundle/.part are skipped, so a
re-run never re-fetches or duplicates a record. 404 and CrawlError keys stay retryable.
BundleWriter is not thread-safe, so writes go through one lock.
"""

import shutil
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock

from scripts.mgnify_v2_crawl import config
from scripts.mgnify_v2_crawl.client import CrawlError, get_json
from scripts.mgnify_v2_crawl.writer import BundleWriter, read_keys


def fetch_entities(
    entity_type,
    keys,
    path_fn,
    resume,
    out_dir,
    *,
    get=get_json,
    concurrency=config.CONCURRENCY,
) -> dict:
    # The v2 assemblies list returns many accession=None items; a None key would
    # also violate the resume log's NOT NULL constraint.
    raw = list(keys)
    keys = [k for k in raw if k is not None and str(k).strip() != ""]
    null_keys = len(raw) - len(keys)
    # A long paginated list shifts while it is read, so an accession can recur.
    keys = list(dict.fromkeys(keys))
    requested = len(keys)

    bundle_path = out_dir / f"{entity_type}.jsonl.gz"
    part_path = out_dir / f"{entity_type}.jsonl.gz.part"
    skip = resume.done_keys(entity_type) | read_keys(bundle_path) | read_keys(part_path)

    pending = [k for k in keys if k not in skip]
    skipped = requested - len(pending)

    # Seed .part from a finalized bundle so the final os.replace yields a superset
    # instead of clobbering it.
    if bundle_path.exists() and not part_path.exists():
        shutil.copyfile(bundle_path, part_path)

    writer = BundleWriter(out_dir, entity_type)
    write_lock = Lock()
    written = 0
    removed = 0
    failures = []

    def handle(key):
        nonlocal written, removed
        path = path_fn(key)
        try:
            data = get(path)
        except CrawlError as exc:
            resume.mark(entity_type, key, "error")
            failures.append((key, str(exc)))
            return
        if data is None:
            resume.mark(entity_type, key, "removed", 404)
            with write_lock:
                removed += 1
            return
        with write_lock:
            writer.write(key, config.BASE_URL + path, data)
            written += 1
        resume.mark(entity_type, key, "ok", 200)

    try:
        if pending:
            with ThreadPoolExecutor(max_workers=concurrency) as pool:
                futures = [pool.submit(handle, k) for k in pending]
                for fut in as_completed(futures):
                    fut.result()
    finally:
        writer.finalize()

    return {
        "requested": requested,
        "written": written,
        "removed": removed,
        "errors": len(failures),
        "skipped": skipped,
        "null_keys": null_keys,
    }
