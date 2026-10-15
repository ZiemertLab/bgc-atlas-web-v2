"""Crawler configuration constants; the orchestrator may override some at runtime."""

from pathlib import Path

# Trailing slash is significant: paths are appended to it.
BASE_URL = "https://www.ebi.ac.uk/metagenomics/api/v2/"

OUT_DIR = Path("/data/bgc-atlas/data-v2/metadata/mgnify_asms_v2")

# Read-only v1 dump (per-type `<type>.tar.gz` of `<accession>.json`); the report diffs v1 vs v2.
V1_DUMP_DIR = Path("/data/bgc-atlas/data-v2/metadata/mgnify_asms")

# The API exposes no rate-limit headers, so concurrency is kept modest.
CONCURRENCY = 8

PAGE_SIZE = 100

CONNECT_TIMEOUT = 10
READ_TIMEOUT = 60

MAX_RETRIES = 5          # attempts beyond the first
BACKOFF_BASE = 1.5       # seconds: BACKOFF_BASE ** attempt
BACKOFF_CAP = 60         # seconds
