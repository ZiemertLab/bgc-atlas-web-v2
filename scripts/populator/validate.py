from __future__ import annotations
from dataclasses import dataclass, field
from typing import Dict, List
from .schema import TABLES

# mirrors assemblies.source_type CHECK in new-schema/migrations/0001_init_core.sql
_VALID_SOURCE_TYPES = {"metagenome", "MAG", "SAG", "isolate"}

_HARD_KINDS = {"orphan_fk", "duplicate_pk"}

@dataclass
class Report:
    issues: List[dict] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.issues

    @property
    def hard_errors(self) -> List[dict]:
        """Structural issues that must abort the load (FK/PK)."""
        return [i for i in self.issues if i["kind"] in _HARD_KINDS]

    @property
    def domain_issues(self) -> List[dict]:
        """Per-row CHECK violations the orchestrator quarantines by id."""
        return [i for i in self.issues if i["kind"] == "domain"]

def _domain_issues(table: str, rows: List[dict]) -> List[dict]:
    issues: List[dict] = []
    for row in rows:
        rid = row.get("id")
        if table == "bgcs":
            sp, ep = row.get("start_pos"), row.get("end_pos")
            if sp is not None and sp < 0:
                issues.append({"kind": "domain", "table": table,
                               "rule": "start_pos>=0", "id": rid})
            if sp is not None and ep is not None and sp > ep:
                issues.append({"kind": "domain", "table": table,
                               "rule": "start_pos<=end_pos", "id": rid})
            cs, ce = row.get("core_start_pos"), row.get("core_end_pos")
            if cs is not None and sp is not None and ep is not None:
                if cs < sp or (ce is not None and ce > ep):
                    issues.append({"kind": "domain", "table": table,
                                   "rule": "chk_core_coordinates", "id": rid})
            gm = row.get("gcf_membership")
            if gm is not None and gm < 0.0:
                issues.append({"kind": "domain", "table": table,
                               "rule": "gcf_membership>=0", "id": rid})
        elif table == "assemblies":
            st = row.get("source_type")
            if st is not None and st not in _VALID_SOURCE_TYPES:
                issues.append({"kind": "domain", "table": table,
                               "rule": "source_type_enum", "id": rid})
        elif table == "taxonomies":
            rd = row.get("rank_depth")
            if rd is not None and not (1 <= rd <= 7):
                issues.append({"kind": "domain", "table": table,
                               "rule": "chk_rank_depth", "id": rid})
    return issues

def validate_tables(tables: Dict[str, List[dict]]) -> Report:
    """Validate registry output: PK uniqueness, FK integrity, and domain rules
    mirroring the DB CHECK constraints. FK checks skip parent tables absent from
    `tables`."""
    report = Report()
    for table, rows in tables.items():
        spec = TABLES.get(table)
        if spec is None:
            continue
        if "id" in spec.columns:
            counts: Dict[object, int] = {}
            for row in rows:
                rid = row.get("id")
                counts[rid] = counts.get(rid, 0) + 1
            for rid, cnt in counts.items():
                if cnt > 1:
                    report.issues.append({"kind": "duplicate_pk", "table": table,
                                          "id": rid, "count": cnt})
        for col, parent in spec.fks.items():
            parent_rows = tables.get(parent)
            if parent_rows is None:
                continue  # parent not in this validation scope
            parent_ids = {r.get("id") for r in parent_rows}
            for row in rows:
                v = row.get(col)
                if v is not None and v not in parent_ids:
                    report.issues.append({"kind": "orphan_fk", "table": table,
                                          "column": col, "parent": parent,
                                          "value": v, "id": row.get("id")})
        # Catches drift between the _PROVENANCE map and the names adapters emit.
        if "data_source_ids" in spec.columns and tables.get("data_sources") is not None:
            ds_ids = {r.get("id") for r in tables["data_sources"]}
            for row in rows:
                for v in (row.get("data_source_ids") or []):
                    if v not in ds_ids:
                        report.issues.append({"kind": "orphan_fk", "table": table,
                                              "column": "data_source_ids",
                                              "parent": "data_sources",
                                              "value": v, "id": row.get("id")})
        report.issues.extend(_domain_issues(table, rows))
    return report
