import csv, json, logging
from typing import Dict, Optional, Tuple

log = logging.getLogger("populator")

_LETTER = {"d": "domain", "p": "phylum", "c": "class", "o": "order_name",
           "f": "family", "g": "genus", "s": "species"}

_VALID_SOURCE_TYPES = {"isolate", "MAG", "SAG"}

def parse_gtdb_lineage(lineage: str) -> dict:
    """Rank columns keep the prefixed value (domain='d__Bacteria'); the app strips it.
    `gtdb_lineage` joins populated ranks only: it is the UNIQUE natural key and must
    dedup the same way the legacy importer does."""
    fields = {"source": "gtdb"}
    populated = []
    for part in lineage.split(";"):
        part = part.strip()
        letter, sep, value = part.partition("__")   # GTDB names contain no '__'
        if not sep:
            continue
        col = _LETTER.get(letter.strip())
        if col and value.strip():
            fields[col] = part
            populated.append(part)
    fields["gtdb_lineage"] = ";".join(populated)
    depth = len(populated)
    fields["rank_depth"] = depth if depth >= 1 else 1
    fields["is_partial"] = fields["rank_depth"] < 7
    return fields

# gtdb_genome_category is added by the adapter from hq_mimag.
_BAC120_META_KEYS = ("ncbi_organism_name", "ncbi_isolation_source", "gtdb_taxonomy",
                     "gtdb_representative", "ncbi_taxonomy", "ncbi_taxid",
                     "ncbi_species_taxid", "ncbi_bioproject", "ncbi_submitter",
                     "ncbi_genome_representation")


def _clean(v) -> Optional[str]:
    v = (v or "").strip()
    return v if v and v.lower() != "none" else None


def _meta_value(key: str, raw) -> Optional[str]:
    """gtdb_representative t/f is rendered as True/False to match the DB."""
    c = _clean(raw)
    if c is None:
        return None
    if key == "gtdb_representative":
        return {"t": "True", "f": "False"}.get(c.lower(), c)
    return c


def parse_lat_lon(lat_lon_str: Optional[str]) -> Tuple[Optional[float], Optional[float]]:
    """'32.24 N 119.26 E', '12.3, 45.6' or '12.3 45.6' -> signed (lat, lon). Port of the
    legacy parser: a comma is a field separator, matching the source's '.' decimals."""
    if not lat_lon_str or not lat_lon_str.strip() or lat_lon_str.strip().lower() == "none":
        return None, None
    try:
        cleaned = lat_lon_str.strip().upper()
        parts = cleaned.split(",") if "," in cleaned else cleaned.split()
        if len(parts) < 2:
            return None, None
        lat_mult = lon_mult = 1
        if len(parts) == 4:
            lat_str, lat_dir, lon_str, lon_dir = (p.strip() for p in parts)
            lat_mult = -1 if lat_dir == "S" else 1
            lon_mult = -1 if lon_dir == "W" else 1
        else:
            lat_str, lon_str = parts[0].strip(), parts[1].strip()
        if "S" in lat_str or "N" in lat_str:
            lat_mult = -1 if "S" in lat_str else 1
            lat_str = lat_str.replace("N", "").replace("S", "").strip()
        if "W" in lon_str or "E" in lon_str:
            lon_mult = -1 if "W" in lon_str else 1
            lon_str = lon_str.replace("E", "").replace("W", "").strip()
        latitude = float(lat_str) * lat_mult
        longitude = float(lon_str) * lon_mult
        if -90 <= latitude <= 90 and -180 <= longitude <= 180:
            return latitude, longitude
        return None, None
    except (ValueError, IndexError):
        return None, None


def load_bac120_sample_meta(path) -> Dict[str, dict]:
    out: Dict[str, dict] = {}
    with open(path, newline="") as fh:
        for row in csv.DictReader(fh, delimiter="\t"):
            acc = (row.get("accession") or "").strip()
            if not acc:
                continue
            sf: dict = {}
            lat, lon = parse_lat_lon(row.get("ncbi_lat_lon"))
            if lat is not None:
                sf["latitude"], sf["longitude"] = lat, lon
            country = _clean(row.get("ncbi_country"))
            if country:
                sf["geographic_location"] = country
            md = {k: v for k in _BAC120_META_KEYS
                  if (v := _meta_value(k, row.get(k))) is not None}
            if md:
                # Pre-serialized: the cache holds ~715k of these and a string is much
                # smaller than a dict.
                sf["metadata"] = json.dumps(md, separators=(",", ":"))
            if sf:
                out[acc] = sf
    log.info("loaded bac120 sample sidecar: %d genomes from %s", len(out), path)
    return out


def load_gtdb_enrichment(path) -> Dict[str, Tuple[dict, dict, str, str]]:
    """Sidecar from tools.build_gtdb_enrichment_sidecar; rows are
    ``accession<TAB>sample_fields_json<TAB>metadata_json<TAB>bioproject<TAB>study_title``."""
    out: Dict[str, Tuple[dict, dict, str, str]] = {}
    with open(path, newline="") as fh:
        for row in csv.reader(fh, delimiter="\t"):
            if len(row) < 3:
                continue
            acc, sf_json, md_json = row[0], row[1], row[2]
            bioproject = row[3] if len(row) > 3 else ""
            title = row[4] if len(row) > 4 else ""
            out[acc] = (json.loads(sf_json) if sf_json else {},
                        json.loads(md_json) if md_json else {}, bioproject, title)
    log.info("loaded gtdb enrichment sidecar: %d genomes from %s", len(out), path)
    return out


class GtdbMeta:
    def __init__(self, by_accession: Dict[str, Tuple[str, str]]):
        self._d = by_accession
    def get(self, accession: str) -> Optional[Tuple[str, str]]:
        return self._d.get(accession)

def load_gtdb_metadata(path) -> GtdbMeta:
    by: Dict[str, Tuple[str, str]] = {}
    with open(path, newline="") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        for row in reader:
            acc = (row.get("Representative genome") or "").strip()
            if not acc:
                continue
            cat = (row.get("Genome category") or "").strip()
            source_type = cat if cat in _VALID_SOURCE_TYPES else "isolate"
            lineage = (row.get("GTDB taxonomy") or "").strip()
            by[acc] = (source_type, lineage)
    log.info("loaded gtdb metadata: %d genomes from %s", len(by), path)
    return GtdbMeta(by)
