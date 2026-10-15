# Studies biosynthetic precompute

Builds the two tables the `/studies` index + `/studies/[id]` detail page read:

- `gcf_study_count(gcf_id, study_count)` — distinct logical studies per GCF
- `study_bgc_summary(...)` — one row per logical study (collapsed by `study_name`)

## Why offline

Aggregating 16.5M `bgcs` inside Postgres is too slow for the database host, so
`build.py` pulls the needed columns
via a **read-only** DuckDB attach, **detaches**, then computes locally. It never
writes to Postgres. `load.sql` is a separate, deliberate load step.

The study↔sample graph (`studies`, `study_samples`) lives only in Postgres — the
populator output does not emit `study_samples` — which is why the pull comes from
the database.

## One-time setup

```bash
python3 -m venv .venv && . .venv/bin/activate && pip install duckdb
```

`build.py` auto-installs DuckDB's `postgres` extension on first run (needs
network once).

## Run — IN A QUIET WINDOW

The `bgcs` pull is one long sequential read. Do it off-hours. `--threads` = number of live PG connections during the pull; lower is
gentler.

```bash
cd scripts/populator/tools/study_bgc_summary
/path/to/.venv/bin/python build.py --threads 3 --fresh
# gentlest:  --threads 1
```

Then **review the SANITY block** it prints — logical-study count, GCF-coverage
distribution, and the top-15 studies by exclusive GCFs (do these look
biologically credible?). If the numbers look wrong, stop and
reconsider before loading.

## Load

The tables are in the schema baseline. `\copy` can't expand psql variables, so
run psql FROM the `--workdir` that holds the two CSVs:

```bash
cd <workdir>        # e.g. /data/bgc-atlas/data-v2/_study_build
psql "$DATABASE_URL" -f /path/to/scripts/populator/tools/study_bgc_summary/load.sql
```

## Refresh

Re-run `build.py` then `load.sql` whenever the corpus changes (new source
ingested / re-clustering). It is a full rebuild each time — no incremental path.
Never replace it with a live random-access aggregation.

## Parameters

| flag | default | meaning |
|------|---------|---------|
| `--threads` | 3 | DuckDB threads = concurrent live PG connections during the pull |
| `--rare-max` | 3 | a GCF is "rare" if it occurs in ≤ this many studies |
| `--top-n` | 20 | exclusive GCFs stored per study for the detail page |
| `--memory-limit` | 16GB | DuckDB memory cap (spills to `_work/duckdb_tmp` beyond it) |
| `--fresh` | off | delete the DuckDB work file before building |
