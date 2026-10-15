"""Backfill GTDB studies + study_samples into bgc_atlas_v2.

A GTDB genome's study is the BioProject linked from its BioSample, falling back to
GTDB's ncbi_bioproject (for RefSeq genomes that is the umbrella PRJNA224116).

Authoritative: --apply deletes all GTDB study_samples, re-links them, and removes
GTDB-only studies left without links. A BioProject already owned by another source
(accession is UNIQUE) is reused, with GTDB appended to its provenance.

``--emit-bioprojects FILE`` writes the chosen BioProjects for the title crawl and
exits; crawl titles into --bp-cache-dir, then run --apply.

Usage:
    PGPASSWORD=... python -m scripts.populator.tools.backfill_gtdb_studies \
        --dump <gtdb_sample_metadata.tsv> --biosample-cache <biosample_cache> \
        --bioproject <bioproject_r232.tsv> [--bp-cache-dir <bioproject_cache>] \
        [--emit-bioprojects FILE] [--dbname bgc_atlas_v2] [--apply]
"""
import argparse
import os
import sys

import psycopg2
from psycopg2.extras import execute_values

from scripts.populator.ids import entity_id, scoped
from scripts.populator.tools.gtdb_study_map import (
    load_acc_bioproject, name_to_biosample, load_biosample_bioprojects,
    load_titles,
)

GTDB_SOURCE = "GTDB"
_FLUSH = 20000


def _connect(dbname):
    return psycopg2.connect(host=os.environ.get("PGHOST", "localhost"),
                            user=os.environ.get("PGUSER", "bgc_owner"),
                            password=os.environ["PGPASSWORD"], dbname=dbname)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dump", required=True)
    ap.add_argument("--biosample-cache", required=True)
    ap.add_argument("--bioproject", required=True, help="accession<TAB>ncbi_bioproject TSV (fallback)")
    ap.add_argument("--bp-cache-dir", help="dir of crawl_ncbi_bioproject bp_*.xml (titles)")
    ap.add_argument("--emit-bioprojects", help="write distinct chosen BioProjects here and exit")
    ap.add_argument("--dbname", default="bgc_atlas_v2")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    print("loading mappings (dump biosample, biosample->bioproject links, gtdb fallback) ...",
          flush=True)
    n2bs = name_to_biosample(args.dump)
    bs2bp = load_biosample_bioprojects(args.biosample_cache)
    acc_bp = load_acc_bioproject(args.bioproject)
    print(f"  name->biosample: {len(n2bs)} | biosample->bioproject: {len(bs2bp)} | "
          f"gtdb fallback acc->bp: {len(acc_bp)}", flush=True)

    conn = _connect(args.dbname)
    conn.autocommit = False
    cur = conn.cursor()
    cur.execute("SELECT id FROM data_sources WHERE name=%s", (GTDB_SOURCE,))
    gtdb_ds = str(cur.fetchone()[0])
    cur.execute(
        """SELECT s.name, s.id FROM samples s WHERE EXISTS (
               SELECT 1 FROM data_sources d WHERE d.name=%s AND d.id=ANY(s.data_source_ids))""",
        (GTDB_SOURCE,))
    name_to_id = {name: str(sid) for name, sid in cur.fetchall()}
    print(f"GTDB samples: {len(name_to_id)}", flush=True)

    bp_samples = []                    # (bioproject, sample_id)
    via_biosample = 0
    for name, sid in name_to_id.items():
        bs = n2bs.get(name)
        from_link = bs2bp.get(bs) if bs else None
        bp = from_link or acc_bp.get(name)
        if bp:
            bp_samples.append((bp, sid))
            if from_link:
                via_biosample += 1
    used_bps = sorted({bp for bp, _ in bp_samples})
    print(f"genomes with a study: {len(bp_samples)} (via biosample link: {via_biosample}, "
          f"via gtdb fallback: {len(bp_samples) - via_biosample}) | "
          f"distinct BioProjects: {len(used_bps)}", flush=True)

    if args.emit_bioprojects:
        with open(args.emit_bioprojects, "w") as fh:
            fh.write("\n".join(used_bps) + "\n")
        print(f"wrote {len(used_bps)} distinct BioProjects -> {args.emit_bioprojects}", flush=True)
        return 0

    titles = load_titles(args.bp_cache_dir) if args.bp_cache_dir else {}
    print(f"bioprojects with a title: {len(titles)}", flush=True)

    # An accession owned by another source's row is reused; otherwise upsert our entity_id row.
    cur.execute("SELECT accession, id FROM studies WHERE accession = ANY(%s)", (used_bps,))
    existing = {acc: str(sid) for acc, sid in cur.fetchall()}
    bp_to_study, new_studies, foreign = {}, [], []
    for bp in used_bps:
        eid = str(entity_id("studies", scoped("gtdb", bp)))
        if bp in existing and existing[bp] != eid:
            bp_to_study[bp] = existing[bp]
            foreign.append(existing[bp])
        else:
            bp_to_study[bp] = eid
            new_studies.append((eid, bp, bp, bp, bp, titles.get(bp), [gtdb_ds]))
    links = [(bp_to_study[bp], sid) for bp, sid in bp_samples]
    n_titled = sum(1 for s in new_studies if s[5])
    print(f"upsert studies: {len(new_studies)} (titled: {n_titled}) | reuse foreign: "
          f"{len(foreign)} | study_samples links: {len(links)}", flush=True)

    if not args.apply:
        print("dry run (no --apply): no writes performed.")
        for bp in used_bps[:3]:
            print(f"  e.g. {bp} -> {titles.get(bp)!r}")
        return 0

    # Reset first: this tool is authoritative for GTDB study links.
    cur.execute(
        """DELETE FROM study_samples ss USING samples s
           WHERE ss.sample_id = s.id AND EXISTS (
               SELECT 1 FROM data_sources d WHERE d.name=%s AND d.id=ANY(s.data_source_ids))""",
        (GTDB_SOURCE,))
    print(f"reset: deleted {cur.rowcount} existing GTDB study_samples", flush=True)

    for i in range(0, len(new_studies), _FLUSH):
        execute_values(
            cur,
            """INSERT INTO studies
                 (id, external_id, accession, bioproject, study_name, title, data_source_ids)
               VALUES %s
               ON CONFLICT (id) DO UPDATE SET
                 title = EXCLUDED.title, study_name = EXCLUDED.study_name,
                 bioproject = EXCLUDED.bioproject, accession = EXCLUDED.accession,
                 data_source_ids = EXCLUDED.data_source_ids, updated_at = now()""",
            new_studies[i:i + _FLUSH],
            template="(%s::uuid,%s,%s,%s,%s,%s,%s::uuid[])")
    conn.commit()
    print(f"upserted {len(new_studies)} studies", flush=True)

    if foreign:
        cur.execute(
            """UPDATE studies SET data_source_ids = array_append(data_source_ids, %s::uuid),
                   updated_at = now()
               WHERE id = ANY(%s::uuid[]) AND NOT (%s::uuid = ANY(data_source_ids))""",
            (gtdb_ds, list(set(foreign)), gtdb_ds))
        print(f"added GTDB provenance to {cur.rowcount} foreign studies", flush=True)

    for i in range(0, len(links), _FLUSH):
        execute_values(
            cur,
            """INSERT INTO study_samples (study_id, sample_id) VALUES %s
               ON CONFLICT (study_id, sample_id) DO NOTHING""",
            links[i:i + _FLUSH], template="(%s::uuid,%s::uuid)")
        conn.commit()
    print(f"linked {len(links)} study_samples", flush=True)

    # drop GTDB-only studies left with no links (stale rows from a prior run)
    cur.execute(
        """DELETE FROM studies st
           WHERE st.data_source_ids = ARRAY[%s]::uuid[]
             AND NOT EXISTS (SELECT 1 FROM study_samples ss WHERE ss.study_id = st.id)""",
        (gtdb_ds,))
    print(f"cleanup: deleted {cur.rowcount} orphaned GTDB-only studies", flush=True)
    conn.commit()

    cur.execute(
        """SELECT count(DISTINCT ss.sample_id) FROM study_samples ss
           JOIN samples s ON s.id = ss.sample_id
           WHERE EXISTS (SELECT 1 FROM data_sources d
                         WHERE d.name=%s AND d.id=ANY(s.data_source_ids))""",
        (GTDB_SOURCE,))
    print(f"post-backfill GTDB samples with a study: {cur.fetchone()[0]}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
