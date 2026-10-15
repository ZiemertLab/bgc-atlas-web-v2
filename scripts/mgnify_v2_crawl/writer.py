"""JSONL.gz bundle writer: appends to ``.part`` and ``os.replace``s it on finalize, so a
crashed run leaves a recoverable ``.part``. Lines are ``{"_v2_endpoint", "_key", "data"}``.
"""

import gzip
import json
import os
from pathlib import Path

_ENDPOINT_FIELD = "_v2_endpoint"
_KEY_FIELD = "_key"
_DATA_FIELD = "data"


class BundleWriter:
    def __init__(self, out_dir, entity_type):
        self.out_dir = Path(out_dir)
        self.entity_type = entity_type
        self.final_path = self.out_dir / f"{entity_type}.jsonl.gz"
        self.part_path = self.out_dir / f"{entity_type}.jsonl.gz.part"
        self.out_dir.mkdir(parents=True, exist_ok=True)
        # Append mode: reopening continues an existing .part (resume).
        self._fh = gzip.open(self.part_path, "at", encoding="utf-8")

    def write(self, key, endpoint, data):
        record = {_ENDPOINT_FIELD: endpoint, _KEY_FIELD: key, _DATA_FIELD: data}
        line = json.dumps(record, ensure_ascii=False, separators=(",", ":"))
        self._fh.write(line)
        self._fh.write("\n")

    def close(self):
        if self._fh is not None:
            self._fh.close()
            self._fh = None

    def finalize(self):
        self.close()
        os.replace(self.part_path, self.final_path)


def read_keys(path) -> set:
    path = Path(path)
    if not path.exists():
        return set()
    keys = set()
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        try:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    keys.add(json.loads(line)[_KEY_FIELD])
                except (json.JSONDecodeError, ValueError):
                    # A crash truncates only the final line.
                    break
        except (EOFError, OSError, gzip.BadGzipFile):
            # A half-written .part can end on a truncated gzip member.
            pass
    return keys
