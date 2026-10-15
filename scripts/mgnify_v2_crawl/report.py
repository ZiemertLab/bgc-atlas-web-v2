"""Coverage report: what the v2 crawl gained over the v1 dump, written to
``<out_dir>/_report/coverage.md``. The headline is v1 samples without lat/lon that now
have coordinates in v2 (joined via ``data.ena_accessions``).
"""

import gzip
import json
import tarfile
from pathlib import Path

from scripts.mgnify_v2_crawl.writer import read_keys

_TYPES = ("assemblies", "samples", "runs", "studies", "analyses")


def _nonempty(value) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return value.strip() != ""
    return True


def count_v1_members(tar_path) -> int:
    tar_path = Path(tar_path)
    if not tar_path.exists():
        return 0
    count = 0
    with tarfile.open(tar_path, "r:gz") as tf:
        for member in tf:
            if member.isfile() and member.name.endswith(".json"):
                count += 1
    return count


def v1_samples_without_latlon(samples_tar) -> set:
    """Keyed by member basename minus ``.json`` (the ENA secondary accession, e.g. ERS6581385)."""
    samples_tar = Path(samples_tar)
    missing = set()
    if not samples_tar.exists():
        return missing
    with tarfile.open(samples_tar, "r:gz") as tf:
        for member in tf:
            if not (member.isfile() and member.name.endswith(".json")):
                continue
            fh = tf.extractfile(member)
            if fh is None:
                continue
            try:
                obj = json.load(fh)
            except (json.JSONDecodeError, ValueError):
                continue
            attrs = obj.get("attributes") or {}
            if not (_nonempty(attrs.get("latitude")) and _nonempty(attrs.get("longitude"))):
                accession = Path(member.name).name[: -len(".json")]
                missing.add(accession)
    return missing


def v2_samples_latlon_index(samples_jsonl_gz) -> dict:
    """Every ENA accession a record carries (SAMEA and ERS forms) -> has lat and lon."""
    samples_jsonl_gz = Path(samples_jsonl_gz)
    index = {}
    if not samples_jsonl_gz.exists():
        return index
    with gzip.open(samples_jsonl_gz, "rt", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)["data"]
            except (json.JSONDecodeError, ValueError, KeyError):
                # A crash truncates only the last line; stop after intact records.
                break
            if not isinstance(data, dict):
                continue
            meta = data.get("metadata") or {}
            has_latlon = _nonempty(meta.get("lat")) and _nonempty(meta.get("lon"))
            for ena in data.get("ena_accessions") or []:
                index[ena] = has_latlon
    return index


def samples_gained_latlon(v1_no_latlon, v2_index) -> int:
    return sum(1 for acc in v1_no_latlon if v2_index.get(acc) is True)


def _removed_error_counts(resume, entity_type):
    rows = resume._conn.execute(
        "SELECT status, COUNT(*) FROM crawl WHERE entity_type = ? "
        "AND status IN ('removed', 'error') GROUP BY status",
        (entity_type,),
    ).fetchall()
    counts = {status: n for status, n in rows}
    return counts.get("removed", 0), counts.get("error", 0)


def write_report(out_dir, v1_dir, stats, resume) -> Path:
    out_dir = Path(out_dir)
    v1_dir = Path(v1_dir)
    report_dir = out_dir / "_report"
    report_dir.mkdir(parents=True, exist_ok=True)

    type_rows = []
    for t in _TYPES:
        v1_count = count_v1_members(v1_dir / f"{t}.tar.gz")
        v2_count = len(read_keys(out_dir / f"{t}.jsonl.gz"))
        type_rows.append((t, v1_count, v2_count))

    v1_no_latlon = v1_samples_without_latlon(v1_dir / "samples.tar.gz")
    v2_index = v2_samples_latlon_index(out_dir / "samples.jsonl.gz")
    gained = samples_gained_latlon(v1_no_latlon, v2_index)

    lines = []
    lines.append("# MGnify v2 crawl — coverage report")
    lines.append("")
    lines.append(f"- v1 dump: `{v1_dir}`")
    lines.append(f"- v2 dump: `{out_dir}`")
    lines.append("")

    lines.append("## Headline: samples that gained lat/lon")
    lines.append("")
    lines.append(
        f"**{gained}** sample(s) lacked coordinates in v1 (lat/lon null or empty) "
        f"and now have them in v2, joined via `data.ena_accessions`."
    )
    lines.append("")
    lines.append(f"- v1 samples without lat/lon: {len(v1_no_latlon)}")
    lines.append("")

    lines.append("## Per-type counts (v1 vs v2)")
    lines.append("")
    lines.append("| type | v1 | v2 | delta |")
    lines.append("| --- | ---: | ---: | ---: |")
    for t, v1_count, v2_count in type_rows:
        lines.append(f"| {t} | {v1_count} | {v2_count} | {v2_count - v1_count:+d} |")
    lines.append("")

    lines.append("## Removed (404) / errors (from resume log)")
    lines.append("")
    lines.append("| entity_type | removed | error |")
    lines.append("| --- | ---: | ---: |")
    entity_types = list(dict.fromkeys(list(_TYPES) + list(stats.keys())))
    for t in entity_types:
        removed, errors = _removed_error_counts(resume, t)
        lines.append(f"| {t} | {removed} | {errors} |")
    lines.append("")

    lines.append("## Crawl stats (per phase)")
    lines.append("")
    if stats:
        lines.append("```json")
        lines.append(json.dumps(stats, indent=2, sort_keys=True, default=str))
        lines.append("```")
    else:
        lines.append("_(no stats recorded)_")
    lines.append("")

    path = report_dir / "coverage.md"
    path.write_text("\n".join(lines), encoding="utf-8")
    return path
