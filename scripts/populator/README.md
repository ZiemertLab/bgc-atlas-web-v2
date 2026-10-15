# Atlas Populator

A Python ETL package that reads the raw sources (antiSMASH JSON and GBK output,
catalogue metadata) and emits one typed parquet or TSV file per database table.
Primary keys are deterministic UUIDv5s derived from natural keys (`ids.py`), so
re-runs are idempotent and foreign keys stay stable across sources.

```
populate.py      entry point: one unit per source (and dataset), streamed per batch
adapters/        one module per source: custom, metalog, mgnify, gtdb, mag, ...
core/            Registry (dedup + id resolution), writer, GOLD path normalizer
schema.py        the tables and columns the populator emits
validate.py      PK/FK/domain checks; violators are quarantined to rejects/
load.py          builds the \copy script for a populator output directory
tools/           loaders, backfills, derived tables and the OpenSearch builders
data/            per-catalogue reference inputs (see THIRD_PARTY.md)
```

```bash
python -m scripts.populator.populate --config config.yaml --source metalog --emit tsv
```

Start from `config.example.yaml`. The order of a full rebuild (populate, load,
backfills, derived tables, indexes) is in the top-level `README.md`.
