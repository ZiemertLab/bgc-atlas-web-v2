"""Reclassify the generic ``Environmental:Aquatic:Sediment`` bucket by water type.

Moves samples in the generic MIxS-fallback bucket to a specific GOLD path when their
exact (environment_biome, environment_feature) pair is in RECLASSIFY. Exact matching,
not regex, keeps every move auditable (a regex would sweep in freshwater "lake
sediment"). Idempotent.

Usage:
    DATABASE_URL="postgresql://.../bgc_atlas_v2" \
      scripts/populator/.venv/bin/python -m scripts.populator.tools.reclassify_aquatic_sediment \
        [--dbname bgc_atlas_v2] [--apply]

Dry run by default. Refresh the gold-carrying MVs after --apply.
"""
import argparse
import os
import sys
from collections import defaultdict

import psycopg2
from psycopg2.extras import execute_values

SOURCE_PATH = "Environmental:Aquatic:Sediment"

# (environment_biome, environment_feature) -> canonical GOLD path. Exact-match only.
# Curated from the bucket's distinct pairs; ambiguous pairs are deliberately absent.
RECLASSIFY = {
    ("marine sediment [ENVO:03000033]", "shallow marine sediment [ENVO:03000034]"):
        "Environmental:Aquatic:Marine:Sediment",
    ("marine salt marsh biome", "sea shore"): "Environmental:Aquatic:Marine:Sediment",
    ("marine biome", "ocean"): "Environmental:Aquatic:Marine:Sediment",
    ("marine benthic biome", "marine benthic feature"): "Environmental:Aquatic:Marine:Sediment",
    ("marine salt marsh biome", "marine benthic feature"): "Environmental:Aquatic:Marine:Sediment",
    ("marine benthic biome", "marine mud"): "Environmental:Aquatic:Marine:Sediment",
    ("marine benthic biome", "marine reef"): "Environmental:Aquatic:Marine:Sediment",
    ("marine biome", "coastal water body"): "Environmental:Aquatic:Marine:Sediment",
    ("marine benthic biome", "marine subtidal rocky reef"): "Environmental:Aquatic:Marine:Sediment",
    ("marine benthic biome", "tidal mangrove shrubland"): "Environmental:Aquatic:Marine:Sediment",
    ("marine benthic biome", "lagoon"): "Environmental:Aquatic:Marine:Sediment",
    ("marine", "ocean trench"): "Environmental:Aquatic:Marine:Sediment",
    ("marine biome", "marine hydrothermal vent"):
        "Environmental:Aquatic:Marine:Hydrothermal vents:Sediment",
    ("marine hydrothermal vent biome", "marine hydrothermal vent"):
        "Environmental:Aquatic:Marine:Hydrothermal vents:Sediment",
    ("marine biome", "estuary"): "Environmental:Aquatic:Marine:Intertidal zone:Estuary",
    ("freshwater biome", "lake"): "Environmental:Aquatic:Freshwater:Lake:Sediment",
    ("freshwater lake biome", "lake"): "Environmental:Aquatic:Freshwater:Lake:Sediment",
    ("large lake biome", "lake"): "Environmental:Aquatic:Freshwater:Lake:Sediment",
    ("tundra biome", "lake sediment"): "Environmental:Aquatic:Freshwater:Lake:Sediment",
    ("urban pollution", "polluted lake"): "Environmental:Aquatic:Freshwater:Lake:Sediment",
    ("freshwater lake biome", "freshwater lake"): "Environmental:Aquatic:Freshwater:Lake:Sediment",
    ("temperate woodland biome", "lake bottom mud"): "Environmental:Aquatic:Freshwater:Lake:Sediment",
    ("small lake biome", "pond bed"): "Environmental:Aquatic:Freshwater:Lake:Sediment",
    ("lentic water body", "freshwater lake"): "Environmental:Aquatic:Freshwater:Lake:Sediment",
    ("small lake biome", "mesotrophic lake"): "Environmental:Aquatic:Freshwater:Lake:Sediment",
    ("small lake biome", "hypereutrophic lake"): "Environmental:Aquatic:Freshwater:Lake:Sediment",
    ("freshwater biome", "groundwater"): "Environmental:Aquatic:Freshwater:Sediment",
    ("freshwater river biome", "river"): "Environmental:Aquatic:Freshwater:Sediment",
    ("freshwater river biome", "stream sediment"): "Environmental:Aquatic:Freshwater:Sediment",
    ("freshwater biome", "sedimentation in a water body"): "Environmental:Aquatic:Freshwater:Sediment",
    ("small river biome", "tributary"): "Environmental:Aquatic:Freshwater:Sediment",
    ("freshwater biome", "water body"): "Environmental:Aquatic:Freshwater:Sediment",
    ("freshwater biome", "hot spring"): "Environmental:Aquatic:Thermal springs:Sediment",
    ("desert biome", "saline lake"):
        "Environmental:Aquatic:Non-marine Saline and Alkaline:Saline lake:Sediment",
    ("small lake biome", "alkaline salt lake"):
        "Environmental:Aquatic:Non-marine Saline and Alkaline:Soda lake:Sediment",
}


def _connect(dbname: str):
    url = os.environ.get("DATABASE_URL")
    if url:
        return psycopg2.connect(url)
    return psycopg2.connect(
        host=os.environ.get("PGHOST", "localhost"),
        user=os.environ.get("PGUSER", "bgc_owner"),
        password=os.environ["PGPASSWORD"],
        dbname=dbname,
    )


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--dbname", default="bgc_atlas_v2")
    ap.add_argument("--apply", action="store_true", help="write the UPDATEs (default: dry run)")
    args = ap.parse_args()

    conn = _connect(args.dbname)
    conn.autocommit = False
    cur = conn.cursor()
    try:
        cur.execute("SELECT current_database()")
        db = cur.fetchone()[0]
        if db != args.dbname:
            print(f"ABORT: connected to '{db}', expected '{args.dbname}'.", file=sys.stderr)
            return 2
        print(f"connected to {db}", flush=True)

        cur.execute(
            "SELECT id, environment_biome, environment_feature FROM samples "
            "WHERE gold_ecosystem_path = %s", (SOURCE_PATH,))
        rows = cur.fetchall()

        updates = []                       # (id, target, provenance_note)
        by_target = defaultdict(int)
        for sid, biome, feature in rows:
            target = RECLASSIFY.get((biome, feature))
            if target:
                updates.append((str(sid), target, f"{biome} | {feature}"))
                by_target[target] += 1

        print(f"bucket size: {len(rows)}; reclassifying: {len(updates)}; "
              f"left generic: {len(rows) - len(updates)}\n", flush=True)
        for target in sorted(by_target):
            print(f"  [{by_target[target]:>4}]  {target}", flush=True)

        if not updates:
            print("\nnothing to do.", flush=True)
            return 0
        if not args.apply:
            print("\nDRY RUN -- no writes. Re-run with --apply to persist.", flush=True)
            return 0

        execute_values(
            cur,
            "UPDATE samples AS s SET "
            "  gold_ecosystem_path = v.target, "
            "  gold_ecosystem_metadata = coalesce(s.gold_ecosystem_metadata,'{}'::jsonb) "
            "    || jsonb_build_object('source','reclassify_sediment', "
            f"                         'reclassified_from','{SOURCE_PATH}', 'note', v.note), "
            "  updated_at = now() "
            "FROM (VALUES %s) AS v(id, target, note) "
            "WHERE s.id = v.id::uuid",
            updates,
            page_size=max(len(updates), 1),   # single page -> cur.rowcount is accurate
        )
        print(f"\nUPDATE affected {cur.rowcount} rows", flush=True)
        conn.commit()
        print("committed.", flush=True)
        print("\nNOW REFRESH: assembly_samples_mv, gcf_gold_ecosystem_distribution_mv, "
              "bgc_gold_ecosystem_distribution_mv, sample_map_view, sample_summary", flush=True)
        return 0
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
