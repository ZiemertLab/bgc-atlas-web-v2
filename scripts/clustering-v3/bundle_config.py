"""Where a clustering build reads from and writes to, and what it must produce.

  CLUSTERING_SRC    the delivered bundle (master/, bigslice-output-v3/, dedup-v3/, ...)
  CLUSTERING_BUILD  scratch for this build: in/ (extracted inputs), out/ (load CSVs), tmp/
  CLUSTERING_TAG    release tag in family names: '' -> GCF-000042; 'v2b2' -> GCF-v2b2-000042

The expected counts live in <CLUSTERING_BUILD>/expect.json when present (see EXPECT_V3 for the keys). A value
of null means "no independent expectation": the script prints the number but does not gate on it. Every number
put there must come from somewhere other than the build itself (the bundle README, an independent file), or
the check is circular.
"""
from __future__ import annotations

import json
import os

SRC = os.environ.get("CLUSTERING_SRC", "/data/bgc-atlas/data-v2/clustering-v3")
BUILD = os.environ.get("CLUSTERING_BUILD", "/data/bgc-atlas/data-v2/clustering-v3-build")
TAG = os.environ.get("CLUSTERING_TAG", "")
TMP = os.environ.get("CLUSTERING_TMP", os.path.join(BUILD, "tmp"))

# Some bundles ship master_atlas_tax_v3.parquet (a superset with tax_* columns) instead; the builds read no
# tax_* column, so either serves.
_MASTER_CANDIDATES = ("master_atlas_v3.parquet", "master_atlas_tax_v3.parquet")


def master_path() -> str:
    for name in _MASTER_CANDIDATES:
        path = os.path.join(SRC, "master", name)
        if os.path.exists(path):
            return path
    raise FileNotFoundError(f"no master parquet in {SRC}/master ({', '.join(_MASTER_CANDIDATES)})")


# The first v3 build's counts.
EXPECT_V3 = {
    "gcfs_seed": 371_251,
    "gcfs_fragmented": 393_069,
    "gcfs_listed": 617_926,
    "bgc_gcf_total": 19_254_436,
    "bgc_gcf_primary": 14_606_494,
    "bgc_gcf_secondary": 4_647_942,
    "bgc_gcf_by_route": {"seed": 3_238_559, "contained": 11_207_735,
                         "orphan_query": 1_569_829, "residual": 3_238_313},
    "features_rows": 16_491_488,
    "placement": {"placed": 11_368_181, "residual_family": 3_238_313, "unplaced": 1_884_994},
    "hierarchy_rows": 371_251,
    "uncovered_bgcs": 86,
}


def expect() -> dict:
    path = os.path.join(BUILD, "expect.json")
    if os.path.exists(path):
        with open(path) as fh:
            return json.load(fh)
    return EXPECT_V3
