"""Read the GTDB sample-metadata EAV dump (``sample_id, external_id, key, value``)
into per-genome metadata dicts.

``external_id`` equals ``samples.name``. Empty values are the literal ``none`` and
are dropped by ``_clean``. Rows for one genome are contiguous, so ``iter_gtdb_dump``
streams the 1.4 GB file.
"""
import csv
from typing import Dict, Iterator, Tuple

from scripts.populator.adapters.gtdb_metadata import _clean


def iter_gtdb_dump(path) -> Iterator[Tuple[str, dict]]:
    """Yield ``(external_id, {key: cleaned_value})`` per genome, grouping consecutive
    rows. A genome with only empty values still yields ``(id, {})``."""
    with open(path, newline="") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        cur_id = None
        fields: dict = {}
        for row in reader:
            ext = (row.get("external_id") or "").strip()
            if not ext:
                continue
            if ext != cur_id:
                if cur_id is not None:
                    yield cur_id, fields
                cur_id = ext
                fields = {}
            key = (row.get("key") or "").strip()
            val = _clean(row.get("value"))
            if key and val is not None:
                fields[key] = val
        if cur_id is not None:
            yield cur_id, fields


def load_gtdb_dump(path) -> Dict[str, dict]:
    """Materialize the whole dump as ``{external_id: {key: value}}`` (for tests)."""
    out: Dict[str, dict] = {}
    for ext, fields in iter_gtdb_dump(path):
        out.setdefault(ext, {}).update(fields)
    return out
