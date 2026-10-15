"""Phase B: detail-fetch the samples / runs / studies linked from phase A."""

from pathlib import Path

from scripts.mgnify_v2_crawl.client import get_json
from scripts.mgnify_v2_crawl.fetch import fetch_entities

_TYPES = (
    ("samples", "samples/{}"),
    ("runs", "runs/{}"),
    ("studies", "studies/{}"),
)


def run(out_dir, resume, linkage, *, get=get_json) -> dict:
    out_dir = Path(out_dir)
    stats = {}
    for entity_type, tmpl in _TYPES:
        keys = linkage.get(entity_type, set())
        stats[entity_type] = fetch_entities(
            entity_type,
            keys,
            lambda k, _tmpl=tmpl: _tmpl.format(k),
            resume,
            out_dir,
            get=get,
        )
    return stats
