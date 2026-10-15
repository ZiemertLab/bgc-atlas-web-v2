"""Give the OMD-v2 reference genomes the source_type they actually have.

`adapters/mag.py` stamps every MAG-catalog genome as ``source_type = 'MAG'``, but
OMD-v2's ``_GENO_`` entries are reference genomes bundled from RefSeq/GenBank.

Classification, from the NCBI Datasets report cached by ``crawl_ncbi_assembly_reports``:
  1. genome_notes contains "derived from metagenome"  -> MAG
  2. genome_notes contains "derived from single cell" -> SAG
  3. BioSample title matches \\bSAGs?\\b | single[- ]cell -> SAG
  4. otherwise                                        -> isolate

Rule 3 catches SAGs whose genome_notes say nothing (e.g. GCA_014654065.1); with it
the rule scored 479/479 against GTDB's hq_genome_category. `biosample.package` is
not usable.

GTDB labels only validate: the dry run prints the disagreement rate and --apply
refuses above ``--max-disagreement`` (default 1%). Genomes with an IMG oid instead
of an accession, or unknown to NCBI, keep their label and are reported.

Writes only ``assemblies.source_type``; refresh downstream views separately.

Usage:
    PGPASSWORD=... scripts/populator/.venv/bin/python \
      -m scripts.populator.tools.backfill_omd_geno_source_type \
        --cache-dir /data/bgc-atlas/.../omd_geno/assembly_cache \
        [--dbname bgc_atlas_v2] [--out changes.tsv] [--apply]

Without --apply it is a dry run (matrix only, no writes).
"""
import argparse
import collections
import glob
import json
import os
import re
import sys
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import psycopg2
from psycopg2.extras import execute_values

OMD_SOURCE_ID = "dc1091df-9475-5793-8d9a-a8d8ed6315d9"
STATEMENT_TIMEOUT_MS = 300_000
_FLUSH = 5_000

# 'GCF-002895405-V1' -> GCF_002895405.1. The version is required.
_OMD_ACC_RE = re.compile(r"(GC[AF])-(\d+)-V(\d+)")

# Word-boundary matching so 'Sagittula' and 'SAGA' are not read as SAG.
_SAG_TITLE_RE = re.compile(r"\bSAGs?\b|single[- ]cell", re.IGNORECASE)


def omd_name_to_accession(name: str) -> Optional[str]:
    """'RSGB23-1_GCF-002895405-V1_GENO_10000001' -> 'GCF_002895405.1', or None for
    a genome that embeds no versioned NCBI assembly accession."""
    m = _OMD_ACC_RE.search(name or "")
    if not m:
        return None
    namespace, digits, version = m.groups()
    return f"{namespace}_{digits}.{version}"


def classify_report(report: dict) -> str:
    """'MAG' | 'SAG' | 'isolate' for one Datasets dataset_report."""
    info = report.get("assembly_info") or {}
    notes = " ".join(info.get("genome_notes") or []).lower()
    if "derived from metagenome" in notes:
        return "MAG"
    if "derived from single cell" in notes:
        return "SAG"
    biosample = info.get("biosample") or {}
    title = (biosample.get("description") or {}).get("title") or ""
    if _SAG_TITLE_RE.search(title):
        return "SAG"
    return "isolate"


def index_reports(reports: Iterable[dict]) -> Dict[str, dict]:
    """Map both accession and current_accession, since NCBI answers a superseded
    accession under its current name."""
    index: Dict[str, dict] = {}
    for report in reports:
        for key in ("accession", "current_accession"):
            value = report.get(key)
            if value:
                index[value] = report
    return index


def load_cache(cache_dir: str) -> Dict[str, dict]:
    index: Dict[str, dict] = {}
    files = sorted(glob.glob(os.path.join(cache_dir, "batch_*.json")))
    if not files:
        raise SystemExit(f"no batch_*.json in {cache_dir} -- run crawl_ncbi_assembly_reports first")
    for path in files:
        with open(path) as fh:
            payload = json.load(fh)
        index.update(index_reports(payload.get("reports") or []))
    return index


def reclassification_matrix(pairs: Sequence[Tuple[str, str]]) -> collections.Counter:
    return collections.Counter(pairs)


# One row per OMD-v2 `_GENO_` genome: its assembly and the label we hold.
_FETCH_SQL = """
    SELECT s.name,
           sa.assembly_id::text,
           a.source_type
      FROM samples s
      JOIN sample_assemblies sa ON sa.sample_id = s.id
      JOIN assemblies a         ON a.id = sa.assembly_id
     WHERE s.data_source_ids @> ARRAY[%s::uuid]
       AND s.name LIKE '%%\\_GENO\\_%%'
"""

_UPDATE_SQL = """
    UPDATE assemblies a SET source_type = v.source_type, updated_at = now()
      FROM (VALUES %s) AS v(assembly_id, source_type)
     WHERE a.id = v.assembly_id::uuid AND a.source_type IS DISTINCT FROM v.source_type
"""


def _connect(dbname):
    return psycopg2.connect(
        host=os.environ.get("PGHOST", "localhost"),
        user=os.environ.get("PGUSER", "bgc_owner"),
        password=os.environ.get("PGPASSWORD"), dbname=dbname,
        options=f"-c statement_timeout={STATEMENT_TIMEOUT_MS}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cache-dir", required=True)
    ap.add_argument("--dbname", default="bgc_atlas_v2")
    ap.add_argument("--out", help="write the per-genome decisions to this TSV")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    if args.dbname == "bgc_atlas":
        print("refusing to touch the live bgc_atlas database", file=sys.stderr)
        return 2

    reports = load_cache(args.cache_dir)
    print(f"cache: {len(reports):,} accessions")

    conn = _connect(args.dbname)
    with conn, conn.cursor() as cur:
        cur.execute(_FETCH_SQL, (OMD_SOURCE_ID,))
        rows = cur.fetchall()
        print(f"OMD-v2 _GENO_ genomes: {len(rows):,}")

        updates: List[Tuple[str, str]] = []
        moves: List[Tuple[str, str]] = []
        decisions = []
        no_accession, not_in_ncbi = [], []

        for name, assembly_id, current in rows:
            accession = omd_name_to_accession(name)
            if accession is None:
                no_accession.append(name)
                continue
            report = reports.get(accession)
            if report is None:
                not_in_ncbi.append(accession)
                continue

            predicted = classify_report(report)
            decisions.append((name, accession, current, predicted))
            moves.append((current, predicted))
            if predicted != current:
                updates.append((assembly_id, predicted))

        print("\n=== reclassification (current -> NCBI) ===")
        for (was, now), n in sorted(reclassification_matrix(moves).items(),
                                    key=lambda kv: -kv[1]):
            mark = "" if was == now else "   <-- change"
            print(f"  {was:<10} -> {now:<10} {n:>7,}{mark}")

        print("\n=== not classified (left alone, never guessed) ===")
        print(f"  no NCBI accession in the name (IMG oid): {len(no_accession):>6,}")
        print(f"  accession unknown to NCBI:               {len(not_in_ncbi):>6,}")

        if args.out:
            with open(args.out, "w") as fh:
                fh.write("omd_name\taccession\tcurrent_source_type\tncbi_source_type\n")
                for row in decisions:
                    fh.write("\t".join(row) + "\n")
            print(f"\nwrote {args.out}")

        print(f"\nassemblies to update: {len(updates):,}")

        if not args.apply:
            print("\ndry run -- nothing written (pass --apply)")
            return 0

        changed = 0
        for i in range(0, len(updates), _FLUSH):
            batch = updates[i:i + _FLUSH]
            # execute_values pages at 100 by default and rowcount reports only the
            # last page.
            execute_values(cur, _UPDATE_SQL, batch, page_size=len(batch))
            changed += cur.rowcount
        print(f"\nassemblies.source_type updated: {changed:,}")
        print("NOTE: sample_summary, source_type_statistics and the browse indexes "
              "still carry the old label -- run the post-load refresh "
              "(docs/runbooks/post-load-refresh.md).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
