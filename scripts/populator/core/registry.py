from typing import Dict, List
from collections import OrderedDict
from .record import Record
from .gold_normalize import normalize_gold_ecosystem_path
from .. import ids
from ..schema import TABLES


class Registry:
    def __init__(self):
        self._rows: Dict[str, "OrderedDict[str, Record]"] = {}
        self._prov: Dict[tuple, List[str]] = {}

    def set_provenance(self, table: str, natural_key: str, data_source_names):
        """Attach data_sources names to an entity; finalize() expands them to
        data_source_ids. Accumulates (deduped) across calls."""
        if isinstance(data_source_names, str):
            data_source_names = [data_source_names]
        cur = self._prov.setdefault((table, natural_key), [])
        for n in data_source_names:
            if n not in cur:
                cur.append(n)

    def add(self, rec: Record):
        self._rows.setdefault(rec.table, OrderedDict())
        existing = self._rows[rec.table].get(rec.natural_key)
        if existing is None:
            self._rows[rec.table][rec.natural_key] = rec
        else:
            existing.fields.update(rec.fields)   # last-write-wins; conflicts not detected
            existing.refs.update(rec.refs)

    def drop_dangling_junctions(self) -> dict:
        """Drop junction rows whose ref targets were not emitted, so source gaps don't
        abort on orphan FKs. Returns {table: dropped_count}."""
        from ..schema import TABLES
        dropped = {}
        for table, rows in self._rows.items():
            spec = TABLES.get(table)
            if spec is None or "id" in spec.columns:
                continue
            keep = OrderedDict()
            n_drop = 0
            for nk, rec in rows.items():
                ok = True
                for col, (entity, target_nk) in rec.refs.items():
                    if target_nk not in self._rows.get(entity, {}):
                        ok = False
                        break
                if ok:
                    keep[nk] = rec
                else:
                    n_drop += 1
            if n_drop:
                self._rows[table] = keep
                dropped[table] = n_drop
        return dropped

    def finalize(self) -> Dict[str, List[dict]]:
        out: Dict[str, List[dict]] = {}
        for table, rows in self._rows.items():
            try:
                spec = TABLES[table]
            except KeyError:
                raise KeyError(
                    f"Registry: table {table!r} is not declared in schema.TABLES"
                )
            built = []
            for rec in rows.values():
                row = dict(rec.fields)
                if table == "samples" and row.get("gold_ecosystem_path"):
                    row["gold_ecosystem_path"] = normalize_gold_ecosystem_path(
                        row["gold_ecosystem_path"])
                if "id" in spec.columns:
                    row["id"] = str(ids.entity_id(table, rec.natural_key))
                for col, (entity, nk) in rec.refs.items():
                    if col not in spec.columns:
                        raise KeyError(
                            f"Registry: {table}.refs references undeclared column "
                            f"{col!r} (not in schema.TABLES[{table!r}].columns)"
                        )
                    if entity not in ids.NS:
                        raise KeyError(
                            f"Registry: ref {table}.{col} points at unknown entity "
                            f"{entity!r} (not in ids.NS)"
                        )
                    row[col] = str(ids.entity_id(entity, nk))
                if "data_source_ids" in spec.columns:
                    names = self._prov.get((table, rec.natural_key))
                    if names:
                        row["data_source_ids"] = [
                            str(ids.entity_id("data_sources", n)) for n in names]
                built.append(row)
            out[table] = built
        return out
