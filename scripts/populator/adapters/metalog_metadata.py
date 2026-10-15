"""Map the metalog wide env-metadata TSV onto `samples` fields and ENVO biomes.

``spire_sample_name`` is the join path for ~84% of archives, ``sample_alias`` for the rest.
environment_* columns carry 'label [ENVO:id]': the label goes on the sample, and each
distinct term becomes a `biomes` row, as the legacy loader did.
"""
import csv, json, logging, re
from typing import Dict, List, Optional, Tuple

log = logging.getLogger("populator")

# depth_meters is handled separately (it may be a "lo-hi" range).
_FLOAT_COLS = {
    "longitude": "longitude", "latitude": "latitude",
    "elevation_meters": "elevation_meters",
    "pH": "ph", "current_temperature": "temperature",
    "temperature": "temperature",        # metalog's newer name for current_temperature
    "current_precipitation_mm": "current_precipitation_mm",
    "mean_annual_precipitation_mm": "mean_annual_precipitation_mm",
    "mean_annual_temperature": "mean_annual_temperature",
}
_STR_COLS = {
    "geographic_location": "geographic_location",
    "location_resolution": "location_resolution",
    "collection_date": "collection_date", "collection_date_end": "collection_date_end",
    "environmental_package": "environmental_package",
    "sample_alias": "sample_alias",
    "host_scientific_name": "host_scientific_name",
}
_INT_COLS = {"host_tax_id": "host_taxid"}
_META_COLS = ["study_code", "tax_id", "pmid", "doi"]

# Priority order for a shared envo_id's from_field; the column name is stored as from_field.
_ENV_FIELDS = ("environment_biome", "environment_feature", "environment_material")


_RANGE = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*$")


def parse_envo(term: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
    """'soil [ENVO:00001998]' -> ('soil', 'ENVO:00001998'); no bracket -> (label, None)."""
    if not term:
        return None, None
    t = term.strip()
    if t.endswith("]") and "[" in t:
        label, bracket = t.rsplit("[", 1)
        return (label.strip() or None), (bracket.rstrip("]").strip() or None)
    return (t or None), None


def biome_nk(label: str, envo_id: Optional[str]) -> str:
    """Matches the biomes uniqueness rule: envo_id, else lower(name)."""
    return f"envo:{envo_id}" if envo_id else f"name:{label.strip().lower()}"


def _coerce_float(v) -> Optional[float]:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except ValueError:
        return None


def _coerce_int(v) -> Optional[int]:
    if v is None or v == "":
        return None
    try:
        return int(float(v))   # "4577.0"
    except (ValueError, TypeError):
        return None


def _parse_range(v):
    m = _RANGE.match(v or "")
    return (float(m.group(1)), float(m.group(2))) if m else None


def _row_to_sample_fields(row: dict) -> dict:
    f: dict = {}
    extra = {k: row[k] for k in _META_COLS if row.get(k)}
    for src, dst in _STR_COLS.items():
        v = row.get(src)
        if v:
            f[dst] = v
    for col in _ENV_FIELDS:
        label, _envo = parse_envo(row.get(col))
        if label:
            f[col] = label
    dv = row.get("depth_meters")
    if dv:
        fv = _coerce_float(dv)
        if fv is not None:
            f["depth"] = fv
        else:
            rng = _parse_range(dv)
            if rng:
                f["depth_min_meters"], f["depth_max_meters"] = rng
            else:
                extra["depth_meters_raw"] = dv
    # Non-numeric values are kept raw in metadata rather than dropped.
    for src, dst in _FLOAT_COLS.items():
        v = row.get(src)
        if not v or dst in f:              # first source column that parses wins
            continue
        fv = _coerce_float(v)
        if fv is not None:
            f[dst] = fv
        else:
            extra[f"{src}_raw"] = v
    for src, dst in _INT_COLS.items():
        v = row.get(src)
        if not v:
            continue
        iv = _coerce_int(v)
        if iv is not None:
            f[dst] = iv
        else:
            extra[f"{src}_raw"] = v
    if extra:
        # A JSON string, so the parquet column stays Utf8 and renders as valid JSONB text.
        f["metadata"] = json.dumps(extra, separators=(",", ":"))
    return f


def load_measurements(path) -> Dict[str, List[Tuple[str, str]]]:
    """``{sample_alias: [(key, value), ...]}``; curation_tier is dropped, values kept verbatim."""
    out: Dict[str, List[Tuple[str, str]]] = {}
    with open(path, newline="") as fh:
        for row in csv.DictReader(fh, delimiter="\t"):
            alias = (row.get("sample_alias") or "").strip()
            key = (row.get("metadata_item") or "").strip()
            if not alias or not key:
                continue
            out.setdefault(alias, []).append((key, row.get("value") or ""))
    return out


def _study_key_and_fields(row: dict, key_by_code=frozenset()) -> Optional[Tuple[str, dict]]:
    """study_key is study_accession (possibly a comma-joined list) else study_code, the
    legacy dedup key; a code in ``key_by_code`` keys on the code. external_id stays NULL,
    as in production."""
    code = (row.get("study_code") or "").strip() or None
    acc = (row.get("study_accession") or "").strip() or None
    if not code and not acc:
        return None
    f: dict = {}
    if code:
        f["study_name"] = code
    if acc:
        f["accession"] = acc
    md = {k: v for k in ("pmid", "doi") if (v := (row.get(k) or "").strip())}
    if md:
        f["metadata"] = json.dumps(md, separators=(",", ":"))
    if code in key_by_code:
        return code, f
    return (acc or code), f


class EnvLookup:
    def __init__(self, alias_index: Dict[str, dict], spire_index: Dict[str, List[dict]],
                 envo_canon: Optional[Dict[str, Tuple[Optional[str], Optional[str], str]]] = None,
                 study_canon: Optional[Dict[str, dict]] = None,
                 measurements: Optional[Dict[str, List[Tuple[str, str]]]] = None,
                 key_by_code=frozenset()):
        self._alias = alias_index
        self._spire = spire_index
        self._envo_canon = envo_canon or {}
        # First-seen in file order, so shared rows are identical regardless of ProcessPool order.
        self._study_canon = study_canon or {}
        self._measurements = measurements or {}
        self._key_by_code = frozenset(key_by_code)
        self._warned: set = set()

    def _match_row(self, sample_name: str) -> Optional[dict]:
        # Alias first (exact identity), then spire_sample_name, which matches most archives.
        row = self._alias.get(sample_name)
        if row is None:
            rows = self._spire.get(sample_name)
            if not rows:
                return None
            if len(rows) > 1:
                rows = sorted(rows, key=lambda r: r.get("sample_alias", ""))
                if sample_name not in self._warned:
                    self._warned.add(sample_name)
                    _ENV_SIG = ("latitude", "longitude", "environment_biome",
                                "depth_meters", "elevation_meters")
                    sigs = {tuple(r.get(c, "") for c in _ENV_SIG) for r in rows}
                    if len(sigs) > 1:
                        log.warning("metalog env: spire_sample_name %r maps to %d rows "
                                    "with DIFFERING env values; using sample_alias %r "
                                    "(others discarded)", sample_name, len(rows),
                                    rows[0].get("sample_alias"))
                    else:
                        log.warning("metalog env: spire_sample_name %r maps to %d rows "
                                    "(identical env); using sample_alias %r",
                                    sample_name, len(rows), rows[0].get("sample_alias"))
            row = rows[0]
        return row

    def fields_for(self, sample_name: str) -> Optional[dict]:
        row = self._match_row(sample_name)
        return _row_to_sample_fields(row) if row is not None else None

    def study_code_for(self, sample_name: str) -> Optional[str]:
        """The matched row's OWN study_code (not the canonical study_name of its key)."""
        row = self._match_row(sample_name)
        return ((row.get("study_code") or "").strip() or None) if row is not None else None

    def study_for(self, sample_name: str) -> Optional[Tuple[str, dict]]:
        row = self._match_row(sample_name)
        if row is None:
            return None
        kf = _study_key_and_fields(row, self._key_by_code)
        if kf is None:
            return None
        key = kf[0]
        return key, self._study_canon.get(key, kf[1])

    def measurements_for(self, sample_name: str) -> List[Tuple[str, str]]:
        if not self._measurements:
            return []
        row = self._match_row(sample_name)
        if row is None:
            return []
        alias = (row.get("sample_alias") or "").strip()
        return self._measurements.get(alias, [])

    def biomes_for(self, sample_name: str) -> List[Tuple[str, Optional[str], Optional[str], str]]:
        row = self._match_row(sample_name)
        if row is None:
            return []
        out: List[Tuple[str, Optional[str], Optional[str], str]] = []
        seen: set = set()
        for from_field in _ENV_FIELDS:
            label, envo = parse_envo(row.get(from_field))
            if not label:
                continue
            nk = biome_nk(label, envo)
            if nk in seen:
                continue
            seen.add(nk)
            canon = self._envo_canon.get(nk, (label, envo, from_field))
            out.append((nk, canon[0], canon[1], canon[2]))
        return out


def load_env_metadata(path, measurements_path=None, key_by_code=(),
                      required_codes=()) -> EnvLookup:
    """``key_by_code``: study_codes whose study is keyed on the code rather than the
    per-row study_accession (a study whose rows each carry a different accession,
    e.g. Seitz_2016_estuary); its accession is the sorted distinct accessions,
    comma-joined. ``required_codes``: further study_codes a config names (study
    overrides). Any code in either that no row carries raises: an override that
    silently matches nothing is a config typo, not a no-op."""
    key_by_code = frozenset(key_by_code or ())
    seen_codes: set = set()
    code_accessions: Dict[str, set] = {}
    alias_index: Dict[str, dict] = {}
    spire_index: Dict[str, List[dict]] = {}
    envo_canon: Dict[str, Tuple[Optional[str], Optional[str], str]] = {}
    study_canon: Dict[str, dict] = {}
    with open(path, newline="") as fh:
        for row in csv.DictReader(fh, delimiter="\t"):
            alias = row.get("sample_alias")
            if alias:
                alias_index[alias] = row
            spire = row.get("spire_sample_name")
            if spire:
                spire_index.setdefault(spire, []).append(row)
            # A few study keys carry divergent pmid/doi across rows; first-seen wins.
            kf = _study_key_and_fields(row, key_by_code)
            if kf is not None:
                study_canon.setdefault(kf[0], kf[1])
                code = (row.get("study_code") or "").strip()
                seen_codes.add(code)
                acc = (row.get("study_accession") or "").strip()
                if code in key_by_code and acc:
                    code_accessions.setdefault(code, set()).add(acc)
            # First-seen wins, reproducing the legacy from_field assignment.
            for from_field in _ENV_FIELDS:
                label, envo = parse_envo(row.get(from_field))
                if not label:
                    continue
                nk = biome_nk(label, envo)
                if nk not in envo_canon:
                    envo_canon[nk] = (label, envo, from_field)
    missing = sorted((key_by_code | frozenset(required_codes or ())) - seen_codes)
    if missing:
        raise ValueError(f"metalog env {path}: study override code(s) not in the file: {missing}")
    for code, accs in code_accessions.items():
        study_canon[code] = dict(study_canon[code], accession=", ".join(sorted(accs)))
    measurements = load_measurements(measurements_path) if measurements_path else {}
    return EnvLookup(alias_index, spire_index, envo_canon, study_canon, measurements,
                     key_by_code)
