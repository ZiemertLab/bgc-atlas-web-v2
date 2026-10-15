"""Reader and accession helpers for the native-v2 MGnify metadata bundles.

Sample rows are keyed by the ENA secondary accession (ERS/SRS/DRS) to match the v1 DB
ids, but v2 junctions reference samples by biosample (SAMEA/SAMN/SAMD), hence
:func:`build_biosample_to_secondary`.
"""
import gzip
import json
import re
from typing import Iterator, List, Optional

_SECONDARY_RE = re.compile(r"^(ERS|SRS|DRS)\d+$")
_BIOSAMPLE_RE = re.compile(r"^SAM(EA|N|D)\d+$")


def iter_bundle(path) -> Iterator[dict]:
    """Crash-tolerant: an interrupted write truncates only the final line or gzip member."""
    try:
        fh = gzip.open(path, "rt", encoding="utf-8")
    except FileNotFoundError:
        return
    with fh:
        try:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                    data = obj["data"]
                except (json.JSONDecodeError, ValueError, KeyError, TypeError):
                    break
                if data is None:
                    continue
                yield data
        except (EOFError, OSError, gzip.BadGzipFile):
            return


def secondary_accession(ena_accessions) -> Optional[str]:
    if not isinstance(ena_accessions, list):
        return None
    for acc in ena_accessions:
        if isinstance(acc, str) and _SECONDARY_RE.match(acc):
            return acc
    return None


def biosample_accessions(ena_accessions) -> List[str]:
    if not isinstance(ena_accessions, list):
        return []
    return [acc for acc in ena_accessions
            if isinstance(acc, str) and _BIOSAMPLE_RE.match(acc)]


def sample_natural_key(data) -> Optional[str]:
    """The ENA secondary accession (so ids match v1), else the biosample ``data.accession``."""
    secondary = secondary_accession(data.get("ena_accessions"))
    if secondary:
        return secondary
    return data.get("accession") or None


def build_biosample_to_secondary(samples_bundle_path) -> dict:
    mapping = {}
    for data in iter_bundle(samples_bundle_path):
        key = sample_natural_key(data)
        if key is None:
            continue
        accession = data.get("accession")
        if accession:
            mapping[accession] = key
        for biosample in biosample_accessions(data.get("ena_accessions")):
            mapping[biosample] = key
    return mapping
