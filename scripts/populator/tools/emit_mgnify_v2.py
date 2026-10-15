#!/usr/bin/env python3
"""Re-emit the MGnify metadata-pass TSVs from the native-v2 JSONL bundles.

Runs only the MGnify metadata pass (no bgcs / antismash_runs) through the same
Registry -> provenance -> finalize -> write_tables pipeline as :mod:`populate`,
with records from :func:`mgnify_v2_dump.iter_bundle`. Never touches a database.
"""
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from ..adapters import mgnify
from ..adapters.mgnify_v2_dump import build_biosample_to_secondary, iter_bundle
from ..adapters.mgnify_v2_dump_emit import (
    emit_analysis, emit_assembly, emit_run, emit_sample, emit_study,
)
from ..adapters.mgnify_v2_newtypes import (
    emit_genome, emit_genome_catalogue, emit_publication, emit_super_study,
)
from ..core.record import Record
from ..core.registry import Registry
from ..core.writer import write_tables
from ..schema import TABLES
from ..populate import POPULATOR_VERSION, _provenance_for

log = logging.getLogger("populator")

DEFAULT_BUNDLES = "/data/bgc-atlas/data-v2/metadata/mgnify_asms_v2"
DEFAULT_OUT = "/data/bgc-atlas/data-v2/populator-out-mgnify-v2"

# Identical to the v1 adapter's; seeded first so the [MGnify] provenance tag
# resolves to the existing data_sources id.
DATA_SOURCES_RECORD = Record(
    "data_sources", mgnify.DATA_SOURCE,
    {"name": mgnify.DATA_SOURCE, "source_type": mgnify.SOURCE_TYPE,
     "description": mgnify.DATA_SOURCE_DESC, "source_url": mgnify.DATA_SOURCE_URL},
    {})

# (bundle filename, emitter, needs_map). needs_map: the emitter takes the
# SAMEA->secondary map as a second argument.
EMIT_PLAN = [
    ("samples.jsonl.gz", emit_sample, False),
    ("studies.jsonl.gz", emit_study, False),
    ("assemblies.jsonl.gz", emit_assembly, True),
    ("runs.jsonl.gz", emit_run, True),
    ("analyses.jsonl.gz", emit_analysis, True),
    ("publications.jsonl.gz", emit_publication, False),
    ("super_studies.jsonl.gz", emit_super_study, False),
    ("genome_catalogues.jsonl.gz", emit_genome_catalogue, False),
    ("genomes.jsonl.gz", emit_genome, False),
]

# Same key the v1 mgnify source uses for provenance.
UNIT_KEY = "mgnify"


def _absorb(reg: Registry, rec: Record) -> None:
    """Add ``rec`` to the Registry and tag provenance as the real run does."""
    reg.add(rec)
    if "data_source_ids" in TABLES[rec.table].columns:
        names = _provenance_for(UNIT_KEY, rec.table)
        if names:
            reg.set_provenance(rec.table, rec.natural_key, names)


def emit(bundles: Path, out: Path, *, emit_tsv: bool = True) -> dict:
    """Run the v2 MGnify metadata pass over ``bundles`` and write TSVs to ``out``."""
    samea2sec = build_biosample_to_secondary(bundles / "samples.jsonl.gz")
    log.info("built SAMEA->secondary map: %d entries", len(samea2sec))

    reg = Registry()
    _absorb(reg, DATA_SOURCES_RECORD)

    for filename, emitter, needs_map in EMIT_PLAN:
        path = bundles / filename
        n_recs = n_in = 0
        for data in iter_bundle(path):
            n_in += 1
            recs = emitter(data, samea2sec) if needs_map else emitter(data)
            for rec in recs:
                _absorb(reg, rec)
                n_recs += 1
        log.info("%s: %d input record(s) -> %d emitted record(s)",
                 filename, n_in, n_recs)

    dangling = reg.drop_dangling_junctions()
    if dangling:
        log.info("dropped dangling junction rows (target absent): %s", dangling)
    else:
        log.info("no dangling junction rows dropped")

    tables = reg.finalize()
    manifest = write_tables(tables, out, emit_tsv=emit_tsv, version=POPULATOR_VERSION)
    manifest["dangling_dropped"] = dangling
    (out / "manifest.json").write_text(_json_dump(manifest))
    return manifest


def _json_dump(obj) -> str:
    import json
    return json.dumps(obj, indent=2)


def main(argv=None) -> int:
    logging.basicConfig(level=logging.INFO,
                        format="%(levelname)s %(name)s: %(message)s")
    p = argparse.ArgumentParser(
        description="Re-emit the MGnify metadata-pass TSVs from the native-v2 bundles")
    p.add_argument("--bundles", default=DEFAULT_BUNDLES,
                   help="dir of <type>.jsonl.gz native-v2 bundles "
                        f"(default {DEFAULT_BUNDLES})")
    p.add_argument("--out", default=DEFAULT_OUT,
                   help=f"output dir for the re-emitted TSVs (default {DEFAULT_OUT})")
    p.add_argument("--emit", choices=["tsv", "parquet"], default="tsv",
                   help="output format (default tsv — the loader consumes TSVs)")
    args = p.parse_args(argv)

    bundles = Path(args.bundles)
    if not bundles.is_dir():
        log.error("bundles dir %s does not exist", bundles)
        return 2
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    manifest = emit(bundles, out, emit_tsv=(args.emit == "tsv"))

    print(f"\n=== mgnify-v2 metadata re-emit -> {out} ===")
    for t, e in sorted(manifest["tables"].items()):
        print(f"  {t:24s} {e['row_count']:>9d}")
    dropped = manifest.get("dangling_dropped") or {}
    if dropped:
        print("  dangling junction rows dropped (target absent):")
        for t, n in sorted(dropped.items()):
            print(f"    {t:22s} {n:>9d}")
    else:
        print("  no dangling junction rows dropped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
