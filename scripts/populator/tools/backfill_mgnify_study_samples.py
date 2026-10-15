"""Backfill the missing MGnify ``study_samples`` links into bgc_atlas_v2.

The MGnify ingest loads ``studies`` but no ``study_samples`` links. Both metadata
bundles carry the link (no network needed):
  * v2 ``samples.jsonl.gz``   -> ``data.studies[].accession``
  * v1 ``samples.tar.gz``     -> ``relationships.studies``
  * v2 ``analyses.jsonl.gz``  -> ``assembly.accession`` + ``study_accession``
  * v1 ``assemblies.tar.gz`` / ``analyses.tar.gz`` -> ERZ <-> study

Samples match on ``ena_accessions`` (biosample and secondary ERS/SRS/DRS forms;
``external_id`` uses the latter), studies on ``studies.accession``.

A sample often has several studies (reads vs MGnify's TPA assembly study, or
several modalities), but its BGCs came from one assembly; linking all would inflate
per-study BGC totals. First rule that fires:
  1. ERZ: the studies of the sample's ERZ assemblies (1:1 ERZ -> study).
  2. Title: the single candidate matching an MGnify assembly-study title.
  3. Sole: the only candidate.
Anything else is reported, never guessed.

Writes only ``study_samples``; never touches ``studies``, metrics or matviews.

Usage:
    PGPASSWORD=... scripts/populator/.venv/bin/python \
      -m scripts.populator.tools.backfill_mgnify_study_samples \
        [--v2-dir <.../mgnify_asms_v2>] [--v1-dir <.../mgnify_asms>] \
        [--dbname bgc_atlas_v2] [--out resolved.tsv] [--apply]

Without --apply it is a dry run (resolution counts + examples only, no writes).
"""
import argparse
import gzip
import json
import os
import re
import sys
from collections import defaultdict
from typing import Dict, Iterator, Optional, Set, Tuple

import psycopg2
from psycopg2.extras import execute_values

from scripts.populator.adapters.mgnify_dump import iter_entities, rel_many, rel_one

DEFAULT_V2_DIR = "/data/bgc-atlas/data-v2/metadata/mgnify_asms_v2"
DEFAULT_V1_DIR = "/data/bgc-atlas/data-v2/metadata/mgnify_asms"

# psql connects without the app's DSN options, so cap runaway seq-scans here.
STATEMENT_TIMEOUT_MS = 120_000

_FLUSH = 10_000

# MGnify's generated assembly-study title prefixes.
_ASSEMBLY_RE = re.compile(
    r"^(?:EMG produced TPA\b"
    r"|Meta(?:genome|transcriptome) assembly of .*\bdata set\b)",
    re.IGNORECASE,
)

METHOD_ERZ = "erz"
METHOD_TITLE = "title"
METHOD_SOLE = "sole"
METHOD_UNRESOLVED = "unresolved"


def is_assembly_study(title: Optional[str]) -> bool:
    return bool(title) and _ASSEMBLY_RE.match(title.strip()) is not None


def resolve(candidates: Dict[str, Optional[str]],
            erz_studies: Set[str]) -> Tuple[Set[str], str]:
    """Pick the study accession(s) a sample's BGCs belong to.

    `candidates` maps study accession -> title; `erz_studies` comes from the
    sample's ERZ assemblies. An empty result means unresolved.
    """
    if not candidates:
        return set(), METHOD_UNRESOLVED

    agreed = erz_studies & set(candidates)
    if agreed:
        return agreed, METHOD_ERZ

    assemblies = {a for a, title in candidates.items() if is_assembly_study(title)}
    if len(assemblies) == 1:
        return assemblies, METHOD_TITLE

    if len(candidates) == 1:
        return set(candidates), METHOD_SOLE

    return set(), METHOD_UNRESOLVED


def aliases_v2(data: dict) -> Set[str]:
    """Every accession a v2 record can be matched on: ``ena_accessions`` holds both
    the biosample and the secondary ERS/SRS/DRS form."""
    out = {a for a in (data.get("ena_accessions") or []) if a}
    if data.get("accession"):
        out.add(data["accession"])
    return out


def aliases_v1(accession: str, obj: dict) -> Set[str]:
    out = {accession} if accession else set()
    attrs = obj.get("attributes")
    if isinstance(attrs, dict):
        for key in ("accession", "biosample", "secondary-accession"):
            if attrs.get(key):
                out.add(attrs[key])
    return out


def _iter_jsonl_gz(path: str) -> Iterator[dict]:
    with gzip.open(path, "rt") as fh:
        for line in fh:
            line = line.strip()
            if line:
                yield json.loads(line)


def read_sample_studies(v2_dir: str, v1_dir: str) -> Dict[str, Set[str]]:
    """alias accession -> {MGYS…} from both bundles (v2 samples, v2 analyses, v1 samples)."""
    out: Dict[str, Set[str]] = defaultdict(set)

    for rec in _iter_jsonl_gz(os.path.join(v2_dir, "samples.jsonl.gz")):
        data = rec.get("data") or {}
        studies = {s["accession"] for s in (data.get("studies") or []) if s.get("accession")}
        if studies:
            for alias in aliases_v2(data):
                out[alias] |= studies

    # analyses carry a handful of pairs the samples bundle lacks
    for rec in _iter_jsonl_gz(os.path.join(v2_dir, "analyses.jsonl.gz")):
        data = rec.get("data") or {}
        study, sample = data.get("study_accession"), data.get("sample") or {}
        if study and sample:
            for alias in aliases_v2(sample):
                out[alias].add(study)

    for accession, obj in iter_entities(os.path.join(v1_dir, "samples.tar.gz")):
        studies = {s for s in rel_many(obj, "studies") if s}
        if studies:
            for alias in aliases_v1(accession, obj):
                out[alias] |= studies

    return dict(out)


def read_erz_studies(v2_dir: str, v1_dir: str) -> Dict[str, str]:
    """ERZ accession -> MGYS accession, from both bundles; raises if sources disagree."""
    out: Dict[str, str] = {}

    def put(erz: Optional[str], study: Optional[str], where: str) -> None:
        if not erz or not study or not str(erz).startswith("ERZ"):
            return
        prev = out.get(erz)
        if prev is not None and prev != study:
            raise ValueError(
                f"{where}: ERZ {erz} maps to both {prev} and {study}; "
                "the ERZ->study link is assumed 1:1")
        out[erz] = study

    for rec in _iter_jsonl_gz(os.path.join(v2_dir, "analyses.jsonl.gz")):
        data = rec.get("data") or {}
        put((data.get("assembly") or {}).get("accession"),
            data.get("study_accession"), "v2 analyses")

    for accession, obj in iter_entities(os.path.join(v1_dir, "assemblies.tar.gz")):
        for study in rel_many(obj, "studies"):
            put(accession, study, "v1 assemblies")

    for _, obj in iter_entities(os.path.join(v1_dir, "analyses.tar.gz")):
        put(rel_one(obj, "assembly"), rel_one(obj, "study"), "v1 analyses")

    return out


def _connect(dbname):
    return psycopg2.connect(
        host=os.environ.get("PGHOST", "localhost"),
        user=os.environ.get("PGUSER", "bgc_owner"),
        password=os.environ.get("PGPASSWORD"), dbname=dbname,
        options=f"-c statement_timeout={STATEMENT_TIMEOUT_MS}")


def fetch_db_state(cur) -> Tuple[Dict[str, str], Dict[str, Tuple[str, Optional[str]]],
                                Dict[str, Set[str]]]:
    """(external_id -> sample uuid, MGYS -> (study uuid, title), sample uuid -> {ERZ})."""
    cur.execute("SELECT id FROM data_sources WHERE name = 'MGnify'")
    row = cur.fetchone()
    if row is None:
        raise SystemExit("no data_sources row named 'MGnify'")
    ds_id = row[0]

    cur.execute("SELECT external_id, id FROM samples "
                "WHERE data_source_ids[1] = %s AND external_id IS NOT NULL", (ds_id,))
    samples = {ext: sid for ext, sid in cur.fetchall()}

    cur.execute("SELECT accession, id, title FROM studies "
                "WHERE data_source_ids[1] = %s AND accession IS NOT NULL", (ds_id,))
    studies = {acc: (sid, title) for acc, sid, title in cur.fetchall()}

    cur.execute("""
        SELECT DISTINCT s.id, a.accession
        FROM samples s
        JOIN sample_runs sr    ON sr.sample_id = s.id
        JOIN run_assemblies ra ON ra.run_id = sr.run_id
        JOIN assemblies a      ON a.id = ra.assembly_id
        WHERE s.data_source_ids[1] = %s AND a.accession LIKE 'ERZ%%'
    """, (ds_id,))
    sample_erz: Dict[str, Set[str]] = defaultdict(set)
    for sid, erz in cur.fetchall():
        sample_erz[sid].add(erz)

    return samples, studies, dict(sample_erz)


def build_links(samples, studies, sample_erz, alias_studies, erz_studies):
    """-> (rows of (sample_uuid, study_uuid, external_id, accession, method),
    per-method counts, unresolved external_ids)."""
    rows, counts, unresolved = [], defaultdict(int), []

    for external_id, sample_id in samples.items():
        candidates = {acc: studies[acc][1]
                      for acc in alias_studies.get(external_id, ())
                      if acc in studies}
        erz = {erz_studies[e] for e in sample_erz.get(sample_id, ()) if e in erz_studies}

        chosen, method = resolve(candidates, erz)
        if not chosen:
            unresolved.append(external_id)
            counts[METHOD_UNRESOLVED] += 1
            continue

        counts[method] += 1
        for acc in sorted(chosen):
            rows.append((sample_id, studies[acc][0], external_id, acc, method))

    return rows, dict(counts), unresolved


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--v2-dir", default=DEFAULT_V2_DIR)
    ap.add_argument("--v1-dir", default=DEFAULT_V1_DIR)
    ap.add_argument("--dbname", default="bgc_atlas_v2")
    ap.add_argument("--out", help="write the resolved links to this TSV (audit trail)")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    if args.dbname == "bgc_atlas":
        print("refusing to touch the live v1 database", file=sys.stderr)
        return 2

    print("reading sample->study links ...", flush=True)
    alias_studies = read_sample_studies(args.v2_dir, args.v1_dir)
    print(f"  aliases with >=1 study: {len(alias_studies)}", flush=True)

    print("reading ERZ->study links ...", flush=True)
    erz_studies = read_erz_studies(args.v2_dir, args.v1_dir)
    print(f"  ERZ assemblies mapped: {len(erz_studies)}", flush=True)

    conn = _connect(args.dbname)
    conn.autocommit = False
    cur = conn.cursor()

    samples, studies, sample_erz = fetch_db_state(cur)
    print(f"DB: {len(samples)} MGnify samples | {len(studies)} MGnify studies | "
          f"{len(sample_erz)} samples with ERZ assemblies", flush=True)

    rows, counts, unresolved = build_links(
        samples, studies, sample_erz, alias_studies, erz_studies)

    resolved_samples = len({r[2] for r in rows})
    print(f"resolved: {len(rows)} link rows | {resolved_samples} samples | "
          f"{len({r[3] for r in rows})} studies", flush=True)
    for method in (METHOD_ERZ, METHOD_TITLE, METHOD_SOLE):
        print(f"  {method:>6}: {counts.get(method, 0)} samples")
    if unresolved:
        print(f"  UNRESOLVED: {len(unresolved)} samples "
              f"(e.g. {unresolved[:5]}) -- not inserted", file=sys.stderr)

    if args.out:
        with open(args.out, "w") as fh:
            fh.write("external_id\tstudy_accession\tmethod\n")
            for _, _, ext, acc, method in sorted(rows, key=lambda r: (r[2], r[3])):
                fh.write(f"{ext}\t{acc}\t{method}\n")
        print(f"wrote {args.out}", flush=True)

    if not args.apply:
        print("dry run (no --apply): no writes performed.")
        for _, _, ext, acc, method in rows[:3]:
            print(f"  e.g. {ext} -> {acc} ({method})")
        return 0

    cur.execute("SELECT count(*) FROM study_samples")
    before = cur.fetchone()[0]

    pairs = [(r[0], r[1]) for r in rows]
    for i in range(0, len(pairs), _FLUSH):
        execute_values(
            cur,
            "INSERT INTO study_samples (study_id, sample_id) VALUES %s "
            "ON CONFLICT DO NOTHING",
            [(study_id, sample_id) for sample_id, study_id in pairs[i:i + _FLUSH]])
    conn.commit()

    cur.execute("SELECT count(*) FROM study_samples")
    after = cur.fetchone()[0]
    print(f"study_samples: {before} -> {after} (+{after - before})")
    cur.close()
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
