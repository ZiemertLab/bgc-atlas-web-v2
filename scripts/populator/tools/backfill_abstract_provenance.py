"""Record where every studies.abstract came from, and under what licence.

ENA/MGnify study descriptions are submitter-written and safe to render with
attribution. Crossref and Europe PMC abstracts are verbatim publisher text and may
only be republished if the work's licence allows it.

A DOI in metadata does not prove a Crossref abstract (the metalog tool fell back to
ENA), so each label is proven against the source it names; an unproven abstract
gets a NULL source, which readers treat as not-redistributable. For multi-DOI
studies the DOIs are walked in the original resolver's sorted order.

Only the raw licence URL is stored. ``classify_license`` is for the dry-run report
and mirrors ``isOpenAbstractLicense`` in bgc-atlas/src/lib/abstract-license.ts,
which the UI gates on; keep them in sync.

Writes only the four provenance columns (never abstract/title/study_name) and
overwrites them on re-run. Network results are cached to --cache; --no-network
runs purely from it. Refuses the live bgc_atlas database.

Usage:
    PGPASSWORD=... scripts/populator/.venv/bin/python \
      -m scripts.populator.tools.backfill_abstract_provenance \
        [--cache <path.json>] [--no-network] [--dbname bgc_atlas_v2] [--apply]

Without --apply it is a dry run (counts + examples only, no writes).
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
from typing import Dict, List, Optional, Tuple

import psycopg2
from psycopg2.extras import execute_values

MGNIFY_SOURCE = "MGnify"

# Publisher-text sources, gated by licence. Mirrored by canShowAbstract() in
# src/lib/abstract-license.ts.
PUBLISHER_SOURCES = ("crossref", "europepmc")

TARGET_COLS: List[str] = ["abstract_source", "abstract_doi",
                          "abstract_license", "abstract_publisher"]

STATEMENT_TIMEOUT_MS = 120_000
_FLUSH = 2_000

ENA_URL = "https://www.ebi.ac.uk/ena/portal/api/search"
ENA_BATCH = 50          # OR-chained accessions per request
CROSSREF_URL = "https://api.crossref.org/works/"
USER_AGENT = "bgc-atlas-populator/1.0 (https://bgc-atlas.cs.uni-tuebingen.de; mailto:caner.bagci@uni-tuebingen.de)"
_SLEEP = 0.4

_PRJ_RE = re.compile(r"PRJ[EDN][A-Z]\d+", re.IGNORECASE)
_ID_SEP_RE = re.compile(r"[,;]")
_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")
_ABSTRACT_LEAD_RE = re.compile(r"^\s*abstract[:\s]*", re.IGNORECASE)

# Shared normalized prefix needed to call two abstracts the same: MGnify truncates
# at 2,000 chars and publishers tidy abstracts later.
_MATCH_PREFIX = 120

_CC_RE = re.compile(r"creativecommons\.org/(licenses|publicdomain)/", re.IGNORECASE)


def parse_bioprojects(accession: Optional[str]) -> List[str]:
    """Every PRJ id in an accession cell, uppercased and de-duplicated in order."""
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
    """Flatten a Crossref JATS abstract to plain text.

    Must stay identical to the transform the backfill tools applied before storing,
    so ``abstracts_match`` can use equality.
    """
    if not raw:
        return None
    text = _TAG_RE.sub(" ", raw)
    text = html.unescape(text)
    text = _WS_RE.sub(" ", text).strip()
    text = _ABSTRACT_LEAD_RE.sub("", text).strip()
    return text or None


def normalize_for_match(text: Optional[str]) -> str:
    if not text:
        return ""
    return _WS_RE.sub(" ", str(text)).strip().casefold()


def abstracts_match(stored: Optional[str], candidate: Optional[str]) -> bool:
    """Equal after normalisation, or one is a prefix of the other sharing at least
    _MATCH_PREFIX characters (covers truncation and later publisher edits)."""
    a, b = normalize_for_match(stored), normalize_for_match(candidate)
    if not a or not b:
        return False
    if a == b:
        return True
    shortest = min(len(a), len(b))
    if shortest < _MATCH_PREFIX:
        return False
    return a[:shortest] == b[:shortest]


def choose_license(licenses: Optional[List[dict]]) -> Optional[str]:
    """The licence URL to store from a Crossref work's `license` array.

    Preference: a CC URL on the version of record, then any other VOR URL, then
    anything (so a TDM-only work still records why it is closed). 'am' is excluded
    from the VOR tiers: a CC BY author manuscript says nothing about the published
    abstract.
    """
    if not licenses:
        return None
    entries = [l for l in licenses if isinstance(l, dict) and l.get("URL")]
    if not entries:
        return None

    def version(entry: dict) -> str:
        return (entry.get("content-version") or "unspecified").lower()

    vor = [e for e in entries if version(e) in ("vor", "unspecified")]
    for e in vor:
        if _CC_RE.search(e["URL"]):
            return e["URL"]
    if vor:
        return vor[0]["URL"]
    return entries[0]["URL"]


def classify_license(url: Optional[str]) -> str:
    """'open' | 'closed' for a licence URL; no URL is closed.

    Any CC licence, including NC/ND, permits verbatim reproduction with attribution.
    Mirrored in bgc-atlas/src/lib/abstract-license.ts, which the site gates on.
    """
    if not url:
        return "closed"
    return "open" if _CC_RE.search(url) else "closed"


def _archive(source: str) -> Dict[str, Optional[str]]:
    return {"abstract_source": source, "abstract_doi": None,
            "abstract_license": None, "abstract_publisher": None}


def _published(source: str, doi: str, rec: dict) -> Dict[str, Optional[str]]:
    return {
        "abstract_source": source,
        "abstract_doi": doi,
        "abstract_license": choose_license(rec.get("license")),
        "abstract_publisher": (rec.get("publisher") or "").strip() or None,
    }


def resolve_provenance(study: dict, crossref: Dict[str, dict],
                       ena: Optional[Dict[str, dict]] = None,
                       injected: Optional[List[Tuple[str, str]]] = None) -> Dict[str, Optional[str]]:
    """The four provenance values for one study that already has an abstract.

    Each arm must prove its claim; falling off the end returns a NULL source.
    `injected` ([(text, doi)], e.g. the hardcoded Microflora Danica abstract) is
    checked first because Crossref has no abstract for it. MGnify's connector never
    consulted Crossref, so it short-circuits.
    """
    if study["source"] == MGNIFY_SOURCE:
        return _archive("mgnify")

    for text, doi in (injected or []):
        if abstracts_match(study["abstract"], text):
            return _published("europepmc", doi.lower(), crossref.get(doi.lower()) or {})

    dois = sorted({d.lower() for d in split_ids(study.get("doi"))})
    for doi in dois:
        rec = crossref.get(doi) or {}
        if abstracts_match(study["abstract"], strip_jats(rec.get("abstract"))):
            return _published("crossref", doi, rec)

    # With no DOI, ENA was the resolver's only source; with one, ENA must return the text.
    if not dois:
        return _archive("ena")
    for prj in parse_bioprojects(study.get("accession")):
        if abstracts_match(study["abstract"], (ena or {}).get(prj, {}).get("study_description")):
            return _archive("ena")

    return {"abstract_source": None, "abstract_doi": None,
            "abstract_license": None, "abstract_publisher": None}


def build_update_row(study_id: str, want: Dict[str, Optional[str]]) -> Tuple:
    """Unconditional: these columns are derived, so a re-run overwrites stale licences."""
    return (study_id, *(want.get(c) for c in TARGET_COLS))


def _get(url: str, retries: int = 3) -> Optional[str]:
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


def injected_abstracts() -> List[Tuple[str, str]]:
    """Abstracts a populator adapter hardcodes, imported so an edit there fails
    closed (the study loses its label) rather than mislabelling."""
    from scripts.populator.adapters.mfd_metadata import _MFD_ABSTRACT
    return [(_MFD_ABSTRACT, "10.1038/s41586-025-09794-2")]


def fetch_ena(accessions, cache: Dict[str, dict]) -> None:
    """study_description per BioProject, for corroborating an `ena` label."""
    todo = sorted({a for a in accessions if a not in cache})
    if not todo:
        return
    print(f"  ENA: {len(todo)} bioprojects to fetch", flush=True)
    for i in range(0, len(todo), ENA_BATCH):
        chunk = todo[i:i + ENA_BATCH]
        body = _get(ENA_URL + "?" + urllib.parse.urlencode({
            "result": "study",
            "query": " OR ".join(f"study_accession={a}" for a in chunk),
            "fields": "study_accession,study_description",
            "format": "tsv", "limit": 0,
        }))
        if body:
            for line in body.splitlines()[1:]:
                parts = line.split("\t")
                if len(parts) >= 2:
                    cache[parts[0].upper()] = {"study_description": parts[1]}
        # negative-cache misses
        for a in chunk:
            cache.setdefault(a, {})
        time.sleep(_SLEEP)


def fetch_crossref(dois, cache: Dict[str, dict]) -> None:
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
                rec = {"abstract": msg.get("abstract"),
                       "license": msg.get("license"),
                       "publisher": msg.get("publisher"),
                       "journal": (msg.get("container-title") or [None])[0]}
            except (json.JSONDecodeError, AttributeError):
                rec = {}
        cache[doi] = rec
        if n % 25 == 0 or n == len(todo):
            print(f"    {n}/{len(todo)}", flush=True)
        time.sleep(_SLEEP)


def _connect(dbname):
    return psycopg2.connect(
        host=os.environ.get("PGHOST", "localhost"),
        user=os.environ.get("PGUSER", "bgc_owner"),
        password=os.environ.get("PGPASSWORD"), dbname=dbname,
        options=f"-c statement_timeout={STATEMENT_TIMEOUT_MS}")


def fetch_studies(cur) -> List[dict]:
    cur.execute("""
        SELECT s.id::text, COALESCE(ds.name, ''), s.accession,
               s.abstract, s.metadata->>'doi'
          FROM studies s
          LEFT JOIN data_sources ds ON ds.id = s.data_source_ids[1]
         WHERE s.abstract IS NOT NULL AND btrim(s.abstract) <> ''
    """)
    return [{"id": sid, "source": src, "accession": acc, "abstract": abstract, "doi": doi}
            for sid, src, acc, abstract, doi in cur.fetchall()]


def report(studies: List[dict], resolved: Dict[str, Dict[str, Optional[str]]]) -> None:
    by_source: Dict[str, int] = {}
    by_verdict: Dict[str, int] = {}
    by_license: Dict[str, int] = {}
    for s in studies:
        want = resolved[s["id"]]
        src = want["abstract_source"] or "(unproven)"
        by_source[src] = by_source.get(src, 0) + 1
        if src in PUBLISHER_SOURCES:
            verdict = classify_license(want["abstract_license"])
            by_verdict[verdict] = by_verdict.get(verdict, 0) + 1
            key = want["abstract_license"] or "(no licence published)"
            by_license[key] = by_license.get(key, 0) + 1

    print("\nabstracts by source:")
    for src, n in sorted(by_source.items(), key=lambda kv: -kv[1]):
        print(f"  {src:<12} {n:>6}")

    shown = by_verdict.get("open", 0) + by_source.get("ena", 0) + by_source.get("mgnify", 0)
    withheld = by_verdict.get("closed", 0) + by_source.get("(unproven)", 0)
    print("\npublisher abstracts by licence verdict:")
    for verdict, n in sorted(by_verdict.items(), key=lambda kv: -kv[1]):
        print(f"  {verdict:<12} {n:>6}")
    print(f"\n=> rendered: {shown} | replaced by a DOI link: {withheld}")

    print("\nlicence URLs seen (publisher sources only):")
    for url, n in sorted(by_license.items(), key=lambda kv: -kv[1])[:15]:
        print(f"  {n:>5}  {classify_license(None if url.startswith('(') else url):<6}  {url[:88]}")


def main() -> int:
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cache", default=os.path.join(here, "_abstract_provenance_cache.json"))
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
    candidates = [s for s in studies
                  if s["source"] != MGNIFY_SOURCE and split_ids(s.get("doi"))]
    print(f"studies with an abstract: {len(studies)} | "
          f"crossref candidates (non-MGnify with a DOI): {len(candidates)}", flush=True)

    cache: Dict[str, dict] = {"crossref": {}, "ena": {}}
    if os.path.exists(args.cache):
        with open(args.cache) as fh:
            loaded = json.load(fh)
        # Older caches were a bare {doi: record} map.
        cache.update(loaded if "crossref" in loaded else {"crossref": loaded})
        print(f"cache: crossref={len(cache['crossref'])} ena={len(cache['ena'])}", flush=True)

    injected = injected_abstracts()

    if not args.no_network:
        fetch_crossref((d for s in candidates for d in split_ids(s["doi"])), cache["crossref"])
        fetch_crossref((doi for _, doi in injected), cache["crossref"])
        # Fetch ENA only for studies Crossref didn't explain.
        leftovers = [s for s in candidates
                     if resolve_provenance(s, cache["crossref"], {}, injected)["abstract_source"] is None]
        fetch_ena((p for s in leftovers for p in parse_bioprojects(s["accession"])), cache["ena"])
        with open(args.cache, "w") as fh:
            json.dump(cache, fh)
        print(f"wrote {args.cache}", flush=True)

    resolved = {s["id"]: resolve_provenance(s, cache["crossref"], cache["ena"], injected)
                for s in studies}
    report(studies, resolved)

    updates = [build_update_row(s["id"], resolved[s["id"]]) for s in studies]

    if not args.apply:
        print("\ndry run (no --apply): no writes performed.")
        for s in studies:
            want = resolved[s["id"]]
            if want["abstract_source"] in PUBLISHER_SOURCES:
                print(f"  e.g. {s['accession']} -> {want['abstract_publisher']} | "
                      f"{want['abstract_license']} | {classify_license(want['abstract_license'])}")
                break
        return 0

    for i in range(0, len(updates), _FLUSH):
        execute_values(
            cur,
            """UPDATE studies s SET
                 abstract_source    = v.abstract_source,
                 abstract_doi       = v.abstract_doi,
                 abstract_license   = v.abstract_license,
                 abstract_publisher = v.abstract_publisher,
                 updated_at         = now()
               FROM (VALUES %s) AS v(id, abstract_source, abstract_doi,
                                     abstract_license, abstract_publisher)
               WHERE s.id = v.id::uuid""",
            updates[i:i + _FLUSH])
        conn.commit()
    print(f"\nupdated {len(updates)} study rows", flush=True)

    cur.close()
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
