"""Create the missing `studies` rows for the custom (in-house) datasets.

Custom datasets are loaded with no study, so their samples sit outside /studies.
Each dataset's paper comes from ``data_sources.source_url`` and titles/abstracts
from Crossref; the accession/DOI pairing is declared in CUSTOM_STUDIES and reviewed
by hand. custom_fram_ras's source_url is a PANGAEA sensor dataset, not its study,
so it is declared on its BioProject (47 ENA runs = our 47 samples).

``study_name`` is the data-source key: study_bgc_summary keys on it, so it must stay
stable. Idempotent (matched on UNIQUE ``accession``; links ON CONFLICT DO NOTHING).
Afterwards rebuild study_bgc_summary and the study_titles matviews
(docs/runbooks/post-load-refresh.md). Refuses the live bgc_atlas database.

Usage:
    PGPASSWORD=... scripts/populator/.venv/bin/python \
      -m scripts.populator.tools.backfill_custom_studies [--dbname bgc_atlas_v2] [--apply]

Without --apply it is a dry run (resolved titles + link counts, no writes).
"""
import argparse
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import uuid
from typing import Dict, List, Optional, Tuple

import psycopg2
from psycopg2.extras import execute_values

# data_sources.name -> the study to create for it.
#   accession  : BioProject where one exists, else the DOI; UNIQUE, the idempotency key.
#   doi        : the anchor paper whose title and abstract the study shows.
#   extra_dois : further papers, cited only; joined into metadata.doi comma-separated
#                (what splitIds() in the study API expects).
#   center     : the submitting centre, sourced from ENA or the author affiliation.
#                Never the Crossref publisher (that lives in studies.abstract_publisher).
CUSTOM_STUDIES: Dict[str, Dict[str, object]] = {
    "custom_ziemert_lab": {
        "accession": "10.1093/gigascience/giaf135",
        "doi": "10.1093/gigascience/giaf135",
        # Mirrors adapters/customs_metadata.py `_ZIEMERT_PAPER`, the source of truth.
        "extra_dois": ["10.1128/msystems.01018-21"],
        "center": "Ziemert Lab, University of Tübingen",
    },
    "custom_deep_sea_hydrothermal": {
        "accession": "10.1038/s41597-026-06612-w",
        "doi": "10.1038/s41597-026-06612-w",
        # From Europe PMC; Crossref has no affiliation for this DOI.
        "center": "Portland State University",
    },
    "custom_ocean_surface": {
        "accession": "10.1038/s41597-025-06166-3",
        "doi": "10.1038/s41597-025-06166-3",
        # From Europe PMC; absent from Crossref.
        "center": "Marine Biological Laboratory",
    },
    "custom_fram_ras": {
        "accession": "PRJEB67368",
        "doi": "10.1038/s41467-025-56203-3",
        # ENA's center_name verbatim, matching how the other rows are stored.
        "center": "ETH ZURICH;MAX PLANCK INSTITUTE FOR MARINE MICROBIOLOGY",
    },
    # The two long-read sets, anchored on their BioProjects as FRAM RAS is. Centers are ENA's center_name for each, verbatim.
    "custom_great_barrier_reef": {
        "accession": "PRJEB82623",
        "doi": "10.1038/s41586-026-10778-z",              # Robbins et al., Nature 2026
        "center": "Australian Institute of Marine Science;AIMS",
    },
    "custom_helgoland_2020": {
        # PRJEB52999 already exists from GTDB (213 MAGs, titleless): the samples attach to it and
        # it is filled, not duplicated. The paper is Orellana et al. 2023 (long- vs short-read);
        # ENA links the project to Sidhu et al. 2023, cited alongside.
        "accession": "PRJEB52999",
        "doi": "10.1186/s40168-023-01557-3",
        "extra_dois": ["10.1186/s40168-023-01517-x"],
        "center": "Max Planck Institute for Marine Microbiology",
    },
}

STUDY_TYPE = "metagenomics"
STATEMENT_TIMEOUT_MS = 120_000

CROSSREF_URL = "https://api.crossref.org/works/"
USER_AGENT = "bgc-atlas-populator/1.0 (https://bgc-atlas.cs.uni-tuebingen.de; mailto:caner.bagci@uni-tuebingen.de)"
_SLEEP = 0.4

# Deterministic study ids so a re-run against a wiped table reproduces them.
_NS = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")
_ABSTRACT_LEAD_RE = re.compile(r"^\s*abstract[:\s]*", re.IGNORECASE)


def clean_text(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    return _WS_RE.sub(" ", str(raw)).strip() or None


def strip_jats(raw: Optional[str]) -> Optional[str]:
    """Flatten Crossref's JATS XML abstract to plain text."""
    if not raw:
        return None
    text = html.unescape(_TAG_RE.sub(" ", raw))
    text = _WS_RE.sub(" ", text).strip()
    return _ABSTRACT_LEAD_RE.sub("", text).strip() or None


def study_id_for(source_name: str) -> str:
    return str(uuid.uuid5(_NS, f"bgc-atlas:custom-study:{source_name}"))


def cited_dois(spec: Dict[str, object]) -> Optional[str]:
    """metadata.doi: the anchor DOI, then any extra_dois, comma-joined and deduplicated
    (the format the study API splits on)."""
    anchor = str(spec.get("doi") or "").strip()
    dois = [anchor] if anchor else []
    for extra in spec.get("extra_dois") or []:
        extra = str(extra).strip()
        if extra and extra.lower() not in {d.lower() for d in dois}:
            dois.append(extra)
    return ",".join(dois) or None


def build_study_row(source_name: str, spec: Dict[str, object],
                    source_id: str, crossref: Dict[str, dict]) -> Tuple:
    """The `studies` row for one custom dataset.

    Title and abstract come from the anchor doi only, so one publisher's abstract is
    never credited to another's licence.
    """
    cr = crossref.get(str(spec["doi"]).lower(), {})
    return (
        study_id_for(source_name),
        spec["accession"],
        source_name,                                   # study_name -> study_key
        clean_text(cr.get("title")),
        strip_jats(cr.get("abstract")),
        spec.get("center"),                            # center_name, not the publisher
        STUDY_TYPE,
        [source_id],
        json.dumps({k: v for k, v in (("doi", cited_dois(spec)),
                                      ("journal", clean_text(cr.get("journal"))),
                                      ("year", cr.get("year"))) if v}),
    )


def fetch_crossref(dois: List[str]) -> Dict[str, dict]:
    out: Dict[str, dict] = {}
    for doi in sorted({d.lower() for d in dois if d}):
        url = CROSSREF_URL + urllib.parse.quote(doi, safe="")
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=60) as resp:
                msg = json.loads(resp.read().decode("utf-8", "replace"))["message"]
            out[doi] = {
                "title": (msg.get("title") or [None])[0],
                "abstract": msg.get("abstract"),
                # No `publisher`: it is not a centre (see backfill_abstract_provenance.py).
                "journal": (msg.get("container-title") or [None])[0],
                "year": (msg.get("issued", {}).get("date-parts") or [[None]])[0][0],
            }
        except Exception as exc:                       # noqa: BLE001 - report, don't guess
            print(f"  ! {doi}: {exc}", file=sys.stderr)
            out[doi] = {}
        time.sleep(_SLEEP)
    return out


def _connect(dbname):
    return psycopg2.connect(
        host=os.environ.get("PGHOST", "localhost"),
        user=os.environ.get("PGUSER", "bgc_owner"),
        password=os.environ.get("PGPASSWORD"), dbname=dbname,
        options=f"-c statement_timeout={STATEMENT_TIMEOUT_MS}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dbname", default="bgc_atlas_v2")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    if args.dbname == "bgc_atlas":
        print("refusing to touch the live v1 database", file=sys.stderr)
        return 2

    print("resolving DOIs via Crossref ...", flush=True)
    crossref = fetch_crossref([s["doi"] for s in CUSTOM_STUDIES.values()])

    conn = _connect(args.dbname)
    conn.autocommit = False
    cur = conn.cursor()

    cur.execute("SELECT name, id::text FROM data_sources WHERE name = ANY(%s)",
                (list(CUSTOM_STUDIES),))
    source_ids = dict(cur.fetchall())
    missing = sorted(set(CUSTOM_STUDIES) - set(source_ids))
    if missing:
        print(f"no data_sources row for: {missing}", file=sys.stderr)
        return 2

    # Keep the source name beside its row; row[0] is the study id.
    rows, unresolved = [], []
    for name, spec in CUSTOM_STUDIES.items():
        row = build_study_row(name, spec, source_ids[name], crossref)
        if not row[3]:
            unresolved.append(name)
        rows.append((name, row))

    cur.execute("""
        SELECT ds.name, count(*)
        FROM samples s JOIN data_sources ds ON ds.id = s.data_source_ids[1]
        WHERE ds.name = ANY(%s) GROUP BY 1
    """, (list(CUSTOM_STUDIES),))
    sample_counts = dict(cur.fetchall())

    print(f"\n{'source':<30} {'samples':>7}  study")
    for name, row in rows:
        title, abstract = row[3], row[4]
        print(f"{name:<30} {sample_counts.get(name, 0):>7}  "
              f"{(title or '!! UNRESOLVED')[:72]}")
        if abstract:
            print(f"{'':<30} {'':>7}  abstract: {abstract[:66]}…")
    total_links = sum(sample_counts.get(n, 0) for n in CUSTOM_STUDIES)
    print(f"\nstudies to create: {len(rows)} | study_samples links: {total_links}")
    if unresolved:
        print(f"  UNRESOLVED titles: {unresolved} -- refusing to write a titleless study",
              file=sys.stderr)
        return 1

    if not args.apply:
        print("dry run (no --apply): no writes performed.")
        return 0

    execute_values(cur, """
        INSERT INTO studies (id, accession, study_name, title, abstract,
                             center_name, study_type, data_source_ids, metadata)
        VALUES %s
        ON CONFLICT (accession) DO NOTHING
    """, [row for _, row in rows],
        template="(%s::uuid, %s, %s, %s, %s, %s, %s, %s::uuid[], %s::jsonb)")
    created = cur.rowcount
    conn.commit()

    # A declared accession may already exist from another ingest (PRJEB67368 from
    # GTDB, titleless); fill it rather than duplicate. study_name is never touched.
    filled = 0
    for name, row in rows:
        cur.execute("""
            UPDATE studies SET title = COALESCE(title, %s),
                               -- a withheld abstract was deleted as not redistributable
                               abstract = CASE WHEN abstract_withheld THEN abstract
                                               ELSE COALESCE(abstract, %s) END,
                               center_name = COALESCE(center_name, %s),
                               metadata = metadata || %s::jsonb,
                               updated_at = now()
            WHERE accession = %s
              AND (title IS NULL OR (abstract IS NULL AND NOT abstract_withheld) OR center_name IS NULL)
        """, (row[3], row[4], row[5], row[8], row[1]))
        filled += cur.rowcount
    conn.commit()

    # Resolve by declared accession, not study_name, which differs on a reused row.
    linked = 0
    for name, row in rows:
        cur.execute("""
            INSERT INTO study_samples (study_id, sample_id)
            SELECT st.id, s.id
            FROM samples s
            JOIN data_sources ds ON ds.id = s.data_source_ids[1]
            JOIN studies st ON st.accession = %s
            WHERE ds.name = %s
            ON CONFLICT DO NOTHING
        """, (row[1], name))
        linked += cur.rowcount
    conn.commit()

    print(f"studies created: {created} | existing studies filled: {filled} "
          f"| study_samples links inserted: {linked}")
    print("NEXT: rebuild study_bgc_summary, then refresh the 3 study_titles matviews, "
          "reindex sample_browse, bust Redis.")
    cur.close()
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
