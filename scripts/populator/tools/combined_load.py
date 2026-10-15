#!/usr/bin/env python3
"""Generate one FK-safe Postgres load script for several populator output dirs.

Entity ids are deterministic UUIDv5s, so a shared data_source/study/biome/taxonomy row
appears in several sources with the same id: those tables are deduplicated by id into
<out>/<table>.tsv. Every other table is disjoint per source and loaded as-is. Writes a
.sql script and the merged TSVs; never touches a database. MAG collections load
separately (load_mag_collections.py); gcfs and bgc_gcf come from scripts/clustering-v3.

Usage:
    python -m scripts.populator.tools.combined_load --out DIR SRC_DIR [SRC_DIR ...]
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f DIR/combined-load.sql
"""
import argparse
from collections import Counter
from pathlib import Path

from scripts.populator.schema import TABLES, load_order

DEDUP = {"data_sources", "studies", "biomes", "taxonomies"}


def tsv_files(d: Path, table: str):
    single = d / f"{table}.tsv"
    if single.exists():
        return [single]
    return sorted(d.glob(f"{table}_[0-9]*.tsv"))   # streamed parts (bgcs, bgc_taxonomy)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True, type=Path, help="directory for merged TSVs and the script")
    ap.add_argument("sources", nargs="+", type=Path, help="populator --emit tsv output dirs, one per source")
    args = ap.parse_args(argv)

    out = args.out
    out.mkdir(parents=True, exist_ok=True)
    for t in sorted(DEDUP):
        seen, total = set(), 0
        with open(out / f"{t}.tsv", "w") as fout:
            for src in args.sources:
                for f in tsv_files(src, t):
                    for line in open(f):
                        total += 1
                        rid = line.split("\t", 1)[0]
                        if rid not in seen:
                            seen.add(rid)
                            fout.write(line)
        print(f"  {t:14s} {total:>9d} rows across sources -> {len(seen):>9d} unique")

    lines = ["-- Combined populator load (FK-safe order); shared lookup tables pre-deduplicated.",
             "BEGIN;"]
    for t in load_order():
        cols = ", ".join(TABLES[t].columns)
        files = [out / f"{t}.tsv"] if t in DEDUP else [f for s in args.sources for f in tsv_files(s, t)]
        for f in files:
            if f.exists() and f.stat().st_size:
                lines.append(rf"\copy {t} ({cols}) FROM '{f}' WITH (FORMAT text, NULL '\N');")
    lines.append("COMMIT;")
    script = out / "combined-load.sql"
    script.write_text("\n".join(lines) + "\n")

    c = Counter(ln.split()[1] for ln in lines if ln.startswith(r"\copy "))
    print(f"\nwrote {script} ({sum(c.values())} \\copy statements)")
    for t in load_order():
        if c[t]:
            print(f"  {t:18s} {c[t]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
