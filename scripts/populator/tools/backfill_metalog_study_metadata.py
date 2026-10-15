"""Backfill titles/abstracts/centers onto metalog studies in bgc_atlas_v2.

metalog ingest populates only ``study_name`` (the slug) and ``accession``. Papers
come from the ``{pmid, doi}`` in ``studies.metadata``; ENA resolves BioProject
accessions.

Titles come from the paper only (Crossref, then PubMed). ENA is not a title
fallback: ENA "studies" here are per-sample submissions, so one logical study spans
many distinct titles; studies with no paper keep their slug. Abstracts come from
Crossref, else the ENA study_description when every sibling agrees; center_name is
ENA when consistent; bioproject is derived per row from its own accession.

Resolved per logical study (rows sharing a study_name), because study_bgc_summary
shows one representative row. Fill-only; ``study_name`` is never touched (it is
study_bgc_summary's key). Matched on ``studies.id``, since accession may be missing
or comma-joined. Network results are cached to --cache; --no-network runs from it.

Filling title changes matview output; run the propagation chain afterwards
(docs/runbooks/post-load-refresh.md). Refuses the live bgc_atlas database.

Usage:
    PGPASSWORD=... scripts/populator/.venv/bin/python \
      -m scripts.populator.tools.backfill_metalog_study_metadata \
        [--cache <path.json>] [--no-network] [--dbname bgc_atlas_v2] [--apply]

Without --apply it is a dry run (coverage counts + examples only, no writes).
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
from typing import Dict, Iterable, List, Optional, Tuple

import psycopg2
from psycopg2.extras import execute_values

METALOG_SOURCE = "metalog"

# study_name/accession are deliberately absent; see the module docstring.
TARGET_COLS: List[str] = ["title", "abstract", "center_name", "bioproject"]

STATEMENT_TIMEOUT_MS = 120_000
_FLUSH = 2_000

ENA_URL = "https://www.ebi.ac.uk/ena/portal/api/search"
CROSSREF_URL = "https://api.crossref.org/works/"
PUBMED_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi"
USER_AGENT = "bgc-atlas-populator/1.0 (https://bgc-atlas.cs.uni-tuebingen.de; mailto:caner.bagci@uni-tuebingen.de)"

ENA_BATCH = 50          # OR-chained accessions per request
PUBMED_BATCH = 100
_SLEEP = 0.4

_PRJ_RE = re.compile(r"PRJ[EDN][A-Z]\d+", re.IGNORECASE)
# doi/pmid lists are comma-joined and need not agree in length, so they are
# resolved independently, never zipped.
_ID_SEP_RE = re.compile(r"[,;]")
_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")
# Crossref abstracts often open with a literal "Abstract" heading once tags go.
_ABSTRACT_LEAD_RE = re.compile(r"^\s*abstract[:\s]*", re.IGNORECASE)


def parse_bioprojects(accession: Optional[str]) -> List[str]:
    """Every PRJ id in an accession cell, uppercased and de-duplicated in order.

    Some rows hold an MG-RAST id (``mgp15454``), which is not a BioProject.
    """
    if not accession:
        return []
    seen, out = set(), []
    for m in _PRJ_RE.finditer(accession):
        acc = m.group(0).upper()
        if acc not in seen:
            seen.add(acc)
            out.append(acc)
    return out


def split_ids(value: Optional[str]) -> List[str]:
    """Split a comma/semicolon-joined doi or pmid cell into its parts, in order."""
    if not value:
        return []
    seen, out = set(), []
    for part in _ID_SEP_RE.split(str(value)):
        part = part.strip()
        if part and part not in seen:
            seen.add(part)
            out.append(part)
    return out


def strip_jats(raw: Optional[str]) -> Optional[str]:
    """Flatten Crossref's JATS XML abstract to plain text; None when empty."""
    if not raw:
        return None
    text = _TAG_RE.sub(" ", raw)
    text = html.unescape(text)
    text = _WS_RE.sub(" ", text).strip()
    text = _ABSTRACT_LEAD_RE.sub("", text).strip()
    return text or None


def clean_text(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    text = _WS_RE.sub(" ", str(raw)).strip()
    return text or None


def pick_consistent(values: Iterable[Optional[str]]) -> Optional[str]:
    """The single distinct value, or None when the siblings disagree.

    ENA fields are per submission, so only a value every sibling agrees on is a
    property of the study.
    """
    distinct = {v for v in (clean_text(x) for x in values) if v}
    return distinct.pop() if len(distinct) == 1 else None


def resolve_study_title(dois: Iterable[str], pmids: Iterable[str],
                        crossref: Dict[str, dict], pubmed: Dict[str, dict]) -> Optional[str]:
    """The paper title for a logical study: Crossref first, then PubMed (never ENA).
    Sorted so a multi-paper study resolves the same regardless of row order."""
    for doi in sorted({d.lower() for d in dois}):
        title = clean_text((crossref.get(doi) or {}).get("title"))
        if title:
            return title
    for pmid in sorted({str(p) for p in pmids}):
        title = clean_text((pubmed.get(pmid) or {}).get("title"))
        if title:
            return title
    return None


def resolve_logical(rows: List[dict], crossref: Dict[str, dict],
                    pubmed: Dict[str, dict], ena: Dict[str, dict]) -> Dict[str, Optional[str]]:
    """title/abstract/center_name for one logical study (all rows sharing a study_name)."""
    dois = [d for r in rows for d in split_ids(r.get("doi"))]
    pmids = [p for r in rows for p in split_ids(r.get("pmid"))]
    prjs = [p for r in rows for p in parse_bioprojects(r.get("accession"))]

    title = resolve_study_title(dois, pmids, crossref, pubmed)

    abstract = None
    for doi in sorted({d.lower() for d in dois}):
        abstract = strip_jats((crossref.get(doi) or {}).get("abstract"))
        if abstract:
            break
    if not abstract:
        abstract = pick_consistent((ena.get(p) or {}).get("study_description") for p in prjs)

    return {
        "title": title,
        "abstract": abstract,
        "center_name": pick_consistent((ena.get(p) or {}).get("center_name") for p in prjs),
    }


def row_bioproject(accession: Optional[str]) -> Optional[str]:
    """The row's own first BioProject; per-row because the detail page collects the
    full accession set across siblings."""
    prjs = parse_bioprojects(accession)
    return prjs[0] if prjs else None


def build_update_row(study_id: str, have: Dict[str, Optional[str]],
                     want: Dict[str, Optional[str]]) -> Optional[Tuple]:
    """(id, *TARGET_COLS) with None for columns already populated or unresolved;
    None when nothing would change.

    A withheld abstract (abstract NULL, abstract_withheld true) must not be
    refetched, so it vetoes the abstract column only.
    """
    row: List[Optional[str]] = [study_id]
    touched = False
    for col in TARGET_COLS:
        new = want.get(col) if have.get(col) in (None, "") else None
        if col == "abstract" and have.get("abstract_withheld"):
            new = None
        row.append(new)
        if new is not None:
            touched = True
    return tuple(row) if touched else None


def _get(url: str, params: Optional[dict] = None, retries: int = 3) -> Optional[str]:
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.read().decode("utf-8", "replace")
        except Exception as exc:                       # noqa: BLE001 - report and back off
            if attempt == retries - 1:
                print(f"  ! {url[:90]}: {exc}", file=sys.stderr)
                return None
            time.sleep(2 ** attempt)
    return None


def fetch_ena(accessions: Iterable[str], cache: Dict[str, dict]) -> None:
    todo = sorted({a for a in accessions if a not in cache})
    if not todo:
        return
    print(f"  ENA: {len(todo)} bioprojects to fetch", flush=True)
    for i in range(0, len(todo), ENA_BATCH):
        chunk = todo[i:i + ENA_BATCH]
        body = _get(ENA_URL, {
            "result": "study",
            "query": " OR ".join(f"study_accession={a}" for a in chunk),
            "fields": "study_accession,study_title,study_description,center_name",
            "format": "tsv", "limit": 0,
        })
        found = set()
        if body:
            lines = body.splitlines()
            for line in lines[1:]:
                parts = line.split("\t")
                if len(parts) < 4:
                    continue
                acc, title, descr, center = parts[0], parts[1], parts[2], parts[3]
                cache[acc.upper()] = {"study_title": title, "study_description": descr,
                                      "center_name": center}
                found.add(acc.upper())
        # negative-cache misses
        for a in chunk:
            cache.setdefault(a, {})
        print(f"    {i + len(chunk)}/{len(todo)} ({len(found)} hit)", flush=True)
        time.sleep(_SLEEP)


def fetch_crossref(dois: Iterable[str], cache: Dict[str, dict]) -> None:
    todo = sorted({d.lower() for d in dois if d and d.lower() not in cache})
    if not todo:
        return
    print(f"  Crossref: {len(todo)} DOIs to fetch", flush=True)
    for n, doi in enumerate(todo, 1):
        body = _get(CROSSREF_URL + urllib.parse.quote(doi, safe=""))
        rec = {}
        if body:
            try:
                msg = json.loads(body).get("message", {})
                rec = {"title": (msg.get("title") or [None])[0],
                       "abstract": msg.get("abstract"),
                       "journal": (msg.get("container-title") or [None])[0]}
            except (json.JSONDecodeError, AttributeError):
                rec = {}
        cache[doi] = rec
        if n % 25 == 0 or n == len(todo):
            print(f"    {n}/{len(todo)}", flush=True)
        time.sleep(_SLEEP)


def fetch_pubmed(pmids: Iterable[str], cache: Dict[str, dict]) -> None:
    todo = sorted({str(p) for p in pmids if p and str(p) not in cache})
    if not todo:
        return
    print(f"  PubMed: {len(todo)} PMIDs to fetch", flush=True)
    for i in range(0, len(todo), PUBMED_BATCH):
        chunk = todo[i:i + PUBMED_BATCH]
        body = _get(PUBMED_URL, {"db": "pubmed", "id": ",".join(chunk),
                                 "retmode": "json", "tool": "bgc-atlas"})
        if body:
            try:
                result = json.loads(body).get("result", {})
                for pmid in result.get("uids", []):
                    d = result.get(pmid, {})
                    cache[str(pmid)] = {"title": d.get("title"),
                                        "journal": d.get("fulljournalname")}
            except (json.JSONDecodeError, AttributeError):
                pass
        for p in chunk:
            cache.setdefault(p, {})
        time.sleep(_SLEEP)


def _connect(dbname):
    return psycopg2.connect(
        host=os.environ.get("PGHOST", "localhost"),
        user=os.environ.get("PGUSER", "bgc_owner"),
        password=os.environ.get("PGPASSWORD"), dbname=dbname,
        options=f"-c statement_timeout={STATEMENT_TIMEOUT_MS}")


def fetch_studies(cur) -> List[dict]:
    cur.execute("SELECT id FROM data_sources WHERE name = %s", (METALOG_SOURCE,))
    row = cur.fetchone()
    if row is None:
        raise SystemExit(f"no data_sources row named {METALOG_SOURCE!r}")

    cur.execute("""
        SELECT id::text, study_name, accession, metadata,
               title, abstract, center_name, bioproject, abstract_withheld
        FROM studies WHERE data_source_ids[1] = %s
    """, (row[0],))
    out = []
    for sid, name, acc, meta, title, abstract, center, bioproject, withheld in cur.fetchall():
        meta = meta if isinstance(meta, dict) else {}
        out.append({
            "id": sid, "study_name": name, "accession": acc,
            "doi": meta.get("doi"), "pmid": meta.get("pmid"),
            "have": {"title": title, "abstract": abstract,
                     "center_name": center, "bioproject": bioproject,
                     "abstract_withheld": withheld},
        })
    return out


def main() -> int:
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cache", default=os.path.join(here, "_metalog_study_cache.json"))
    ap.add_argument("--no-network", action="store_true",
                    help="resolve purely from --cache (no HTTP at all)")
    ap.add_argument("--dbname", default="bgc_atlas_v2")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    if args.dbname == "bgc_atlas":
        print("refusing to touch the live v1 database", file=sys.stderr)
        return 2

    conn = _connect(args.dbname)
    conn.autocommit = False
    cur = conn.cursor()
    studies = fetch_studies(cur)
    print(f"metalog studies: {len(studies)} rows / "
          f"{len({s['study_name'] for s in studies})} logical", flush=True)

    cache = {"ena": {}, "crossref": {}, "pubmed": {}}
    if os.path.exists(args.cache):
        with open(args.cache) as fh:
            cache.update(json.load(fh))
        print(f"cache: ena={len(cache['ena'])} crossref={len(cache['crossref'])} "
              f"pubmed={len(cache['pubmed'])}", flush=True)

    if not args.no_network:
        print("fetching ...", flush=True)
        fetch_crossref((d for s in studies for d in split_ids(s["doi"])), cache["crossref"])
        fetch_pubmed((p for s in studies for p in split_ids(s["pmid"])), cache["pubmed"])
        prjs = [p for s in studies for p in parse_bioprojects(s["accession"])]
        fetch_ena(prjs, cache["ena"])
        with open(args.cache, "w") as fh:
            json.dump(cache, fh)
        print(f"wrote {args.cache}", flush=True)

    # study_bgc_summary keys on study_name, so all siblings get the same values.
    by_name: Dict[str, List[dict]] = {}
    for s in studies:
        by_name.setdefault(s["study_name"], []).append(s)

    updates, filled = [], {c: 0 for c in TARGET_COLS}
    titled, untitled = 0, []
    for name, rows in by_name.items():
        shared = resolve_logical(rows, cache["crossref"], cache["pubmed"], cache["ena"])
        if shared["title"]:
            titled += 1
        else:
            untitled.append(name)
        for s in rows:
            want = dict(shared, bioproject=row_bioproject(s["accession"]))
            row = build_update_row(s["id"], s["have"], want)
            if row:
                updates.append(row)
                for col, val in zip(TARGET_COLS, row[1:]):
                    if val is not None:
                        filled[col] += 1

    print(f"logical studies with a paper title: {titled}/{len(by_name)}", flush=True)
    print(f"rows to update: {len(updates)} | "
          + " | ".join(f"+{n} {c}" for c, n in filled.items()), flush=True)
    if untitled:
        print(f"  keeping the study_name slug for {len(untitled)} logical studies "
              f"(no paper; ENA titles are per-sample) e.g. {sorted(untitled)[:4]}")

    if not args.apply:
        print("dry run (no --apply): no writes performed.")
        for row in updates[:3]:
            preview = {c: (v[:70] + "…" if isinstance(v, str) and len(v) > 70 else v)
                       for c, v in zip(TARGET_COLS, row[1:]) if v is not None}
            print(f"  e.g. {row[0]} -> {preview}")
        return 0

    for i in range(0, len(updates), _FLUSH):
        execute_values(
            cur,
            """UPDATE studies s SET
                 title       = COALESCE(s.title, v.title),
                 abstract    = COALESCE(s.abstract, v.abstract),
                 center_name = COALESCE(s.center_name, v.center_name),
                 bioproject  = COALESCE(s.bioproject, v.bioproject),
                 updated_at  = now()
               FROM (VALUES %s) AS v(id, title, abstract, center_name, bioproject)
               WHERE s.id = v.id::uuid""",
            updates[i:i + _FLUSH])
        conn.commit()
    print(f"updated {len(updates)} study rows", flush=True)

    # Only the cached identity columns; study_key and metrics are untouched.
    cur.execute("""
        UPDATE study_bgc_summary sbs
           SET title = s.title, center_name = s.center_name, bioproject = s.bioproject
          FROM studies s
         WHERE s.id = sbs.study_id AND s.id = ANY(%s::uuid[])
    """, ([r[0] for r in updates],))
    conn.commit()
    print(f"re-synced study_bgc_summary identity columns: {cur.rowcount}", flush=True)

    cur.close()
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
