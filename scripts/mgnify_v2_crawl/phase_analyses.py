"""Phase C: analyses list-crawl, linkage filter, detail-fetch.

List items embed ``assembly``/``run``/``sample``, so the whole collection is paged once
and filtered by linkage, without per-assembly subcalls.
"""

import itertools
from pathlib import Path

from scripts.mgnify_v2_crawl.client import get_json
from scripts.mgnify_v2_crawl.fetch import fetch_entities
from scripts.mgnify_v2_crawl.paginate import iter_pages
from scripts.mgnify_v2_crawl.writer import read_keys


def _embedded_accession(item, key):
    sub = item.get(key) or {}
    return sub.get("accession")


def run(out_dir, resume, linkage, *, get=get_json, max_pages=None) -> dict:
    """``max_pages`` caps the LIST scan to that many items (dry-run)."""
    out_dir = Path(out_dir)

    assemblies = read_keys(out_dir / "assemblies.jsonl.gz")
    runs = linkage.get("runs", set())
    samples = linkage.get("samples", set())

    items = iter_pages("analyses/", get=get)
    if max_pages is not None:
        items = itertools.islice(items, max_pages)

    kept = []
    for item in items:
        asm = _embedded_accession(item, "assembly")
        run_acc = _embedded_accession(item, "run")
        smp = _embedded_accession(item, "sample")
        if (asm in assemblies and asm is not None) or run_acc in runs or smp in samples:
            acc = item.get("accession")
            if acc:
                kept.append(acc)

    return fetch_entities(
        "analyses",
        kept,
        lambda a: f"analyses/{a}",
        resume,
        out_dir,
        get=get,
    )
