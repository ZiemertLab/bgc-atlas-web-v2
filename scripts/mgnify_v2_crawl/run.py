"""Orchestrator CLI for the MGnify v2 metadata crawler.

Phases run in dependency order: assemblies -> linked -> analyses -> extras -> report.
Resume is always on, so any phase can be re-run safely.

Usage::

    python -m scripts.mgnify_v2_crawl.run [--out DIR] [--concurrency N]
        [--limit-assemblies N] [--max-pages N]
        [--phase {all,assemblies,linked,analyses,extras,report}] [--resume]
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from scripts.mgnify_v2_crawl import (
    config,
    phase_analyses,
    phase_assemblies,
    phase_extras,
    phase_linked,
    report,
)
from scripts.mgnify_v2_crawl.state import ResumeLog
from scripts.mgnify_v2_crawl.writer import read_keys

_PHASES = ("assemblies", "linked", "analyses", "extras", "report")


def _build_parser():
    p = argparse.ArgumentParser(
        prog="mgnify_v2_crawl.run",
        description="Crawl the MGnify v2 API into lossless native-v2 bundles.",
    )
    p.add_argument(
        "--out", default=str(config.OUT_DIR),
        help="output root for the v2 bundles + resume state (default: config.OUT_DIR)",
    )
    p.add_argument(
        "--concurrency", type=int, default=config.CONCURRENCY,
        help="detail-GET ThreadPool fan-out (default: config.CONCURRENCY)",
    )
    p.add_argument(
        "--limit-assemblies", type=int, default=None, metavar="N",
        help="dry-run: cap the assembly list to the first N accessions",
    )
    p.add_argument(
        "--max-pages", type=int, default=None, metavar="N",
        help="dry-run: cap analyses/extras list scans to the first N items",
    )
    p.add_argument(
        "--phase", choices=("all",) + _PHASES, default="all",
        help="run a single phase (resumable) instead of the full pipeline",
    )
    p.add_argument(
        "--resume", action="store_true",
        help="no-op for clarity: resume is always on via the log + bundles",
    )
    return p


def _sum_written(stats) -> int:
    total = 0
    if isinstance(stats, dict):
        if "written" in stats and isinstance(stats["written"], int):
            total += stats["written"]
        else:
            for value in stats.values():
                total += _sum_written(value)
    return total


def _phase_line(name, stats) -> str:
    def agg(field):
        out = 0
        if isinstance(stats, dict):
            if field in stats and isinstance(stats[field], int):
                out += stats[field]
            else:
                for v in stats.values():
                    if isinstance(v, dict) and isinstance(v.get(field), int):
                        out += v[field]
        return out

    return (
        f"  {name:<11} written={agg('written')} skipped={agg('skipped')} "
        f"removed={agg('removed')} errors={agg('errors')}"
    )


def _analyses_linkage(out_dir):
    linkage = phase_assemblies.linkage_from_assemblies(out_dir)
    linkage["assemblies"] = read_keys(out_dir / "assemblies.jsonl.gz")
    return linkage


def main(argv=None) -> dict:
    args = _build_parser().parse_args(argv)
    out_dir = Path(args.out)
    (out_dir / "_state").mkdir(parents=True, exist_ok=True)

    resume = ResumeLog(str(out_dir / "_state" / "crawl.sqlite"))

    selected = _PHASES if args.phase == "all" else (args.phase,)
    stats = {}
    report_path = None

    try:
        if "assemblies" in selected:
            stats["assemblies"] = phase_assemblies.run(
                out_dir, resume, max_pages=args.limit_assemblies
            )

        if "linked" in selected:
            linkage = phase_assemblies.linkage_from_assemblies(out_dir)
            stats["linked"] = phase_linked.run(out_dir, resume, linkage)

        if "analyses" in selected:
            stats["analyses"] = phase_analyses.run(
                out_dir, resume, _analyses_linkage(out_dir), max_pages=args.max_pages
            )

        if "extras" in selected:
            stats["extras"] = phase_extras.run(out_dir, resume, max_pages=args.max_pages)

        if "report" in selected:
            report_path = report.write_report(out_dir, config.V1_DUMP_DIR, stats, resume)
    finally:
        resume.close()

    total_written = sum(_sum_written(v) for v in stats.values())
    manifest = {
        "params": {
            "out": str(out_dir),
            "concurrency": args.concurrency,
            "limit_assemblies": args.limit_assemblies,
            "max_pages": args.max_pages,
            "phase": args.phase,
        },
        "stats": stats,
        "total_written": total_written,
        "report": str(report_path) if report_path is not None else None,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, indent=2, sort_keys=True, default=str), encoding="utf-8"
    )

    print(f"\nMGnify v2 crawl — {manifest['timestamp']}")
    print(f"out: {out_dir}")
    for name in _PHASES:
        if name in stats:
            print(_phase_line(name, stats[name]))
    print(f"  total written across phases: {total_written}")
    print(f"  manifest: {manifest_path}")
    if report_path is not None:
        print(f"  report:   {report_path}")

    return manifest


if __name__ == "__main__":
    main(sys.argv[1:])
