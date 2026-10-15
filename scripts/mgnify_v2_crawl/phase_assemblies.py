"""Phase A: assemblies (the crawl's anchor) and linkage extraction.

The LIST endpoint is bare, so every accession is detail-fetched; later phases derive
their linkage from the finished bundle on disk.
"""

import gzip
import itertools
import json
from pathlib import Path

from scripts.mgnify_v2_crawl.client import get_json
from scripts.mgnify_v2_crawl.fetch import fetch_entities
from scripts.mgnify_v2_crawl.paginate import iter_pages

_SAMPLE_FIELD = "sample_accession"
_RUN_FIELD = "run_accession"
_STUDY_FIELDS = ("assembly_study_accession", "reads_study_accession")


def run(out_dir, resume, *, get=get_json, max_pages=None) -> dict:
    """``max_pages`` caps the LIST scan to that many items (dry-run)."""
    out_dir = Path(out_dir)
    items = iter_pages("assemblies/", get=get)
    if max_pages is not None:
        items = itertools.islice(items, max_pages)
    # fetch_entities drops and counts accession=None items.
    accessions = [item.get("accession") for item in items]
    return fetch_entities(
        "assemblies",
        accessions,
        lambda a: f"assemblies/{a}",
        resume,
        out_dir,
        get=get,
    )


def linkage_from_assemblies(out_dir) -> dict:
    out_dir = Path(out_dir)
    samples, runs, studies = set(), set(), set()
    bundle = out_dir / "assemblies.jsonl.gz"
    if not bundle.exists():
        return {"samples": samples, "runs": runs, "studies": studies}

    with gzip.open(bundle, "rt", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)["data"]
            except (json.JSONDecodeError, ValueError, KeyError):
                # A truncated trailing line from a crash is always last; stop.
                break
            if not isinstance(data, dict):
                continue
            if data.get(_SAMPLE_FIELD):
                samples.add(data[_SAMPLE_FIELD])
            if data.get(_RUN_FIELD):
                runs.add(data[_RUN_FIELD])
            for field in _STUDY_FIELDS:
                if data.get(field):
                    studies.add(data[field])

    return {"samples": samples, "runs": runs, "studies": studies}
