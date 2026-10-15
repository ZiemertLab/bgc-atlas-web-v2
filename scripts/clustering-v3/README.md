# scripts/clustering-v3

Offline build of the GCF clustering: turns the BiG-SLiCE clustering bundle into the
CSVs the database loads — `gcfs`, `bgc_gcf` and `bgc_features`, plus `gcf_successor` and
`gcf_legacy` when it replaces an earlier clustering (the `\copy` commands are in the
top-level `README.md`, step 3).

## Inputs

Paths and expected counts come from `bundle_config.py`, set through the environment:

```sh
CLUSTERING_SRC=/data/bgc-atlas/data-v2/clustering-v3          # the delivered bundle
CLUSTERING_BUILD=/data/bgc-atlas/data-v2/clustering-v3-build  # in/, out/, tmp/
CLUSTERING_TAG=                                               # '' or a release tag, e.g. v2b2
```

`$CLUSTERING_SRC` is the bundle exported from the HPC cluster where the clustering ran. A
re-clustering numbers its families from 1 again, so it gets a release tag (family names
`GCF-<tag>-000042`) and a `PET_OFFSET` entry in `gcf_pet_name.py`. Counts it must reproduce go
in `$CLUSTERING_BUILD/expect.json` (keys as `EXPECT_V3`), from a source independent of the build. Two inputs
the build needs are not in the export and are read on the cluster itself — see
`reduce_multifamily_identity_v3.py`.

The build reads `master/master_atlas_v3.parquet` from the pipeline (`pipeline/`); taxonomy comes from `scripts/clustering-v2/` (taxonomy v2).

Order: `extract_data_db.sh` → `build_gcfs.py` → `build_bgc_gcf.py` → `build_bgc_features.py`
→ `add_representatives.py` (needs `old/bgc_lengths.csv` exported from `bgcs`). When the build
replaces a loaded clustering, `build_gcf_successor.py` maps every old family to the new ones
(from `old/old_primary.csv` and `old/old_gcfs.csv`, exported before the switch). MIBiG anchors:
`scripts/mibig/build_gcf_mibig_anchor.py`, then `scripts/mibig/load_gcf_mibig_anchor.sql`.

Install `requirements.txt` into a venv; run the tests with
`python -m pytest scripts/clustering-v3/tests`.

## Working notes

- **DuckDB `read_parquet()` can hang on CephFS.** Read with pyarrow
  (`pq.read_table(path, columns=[...])`) and hand the table to DuckDB with
  `con.register("name", tbl)`.
- **Never `to_pylist()` a full 16.5M-row column.** Restrict `columns=`, `.take()` the rows
  you need, then convert.
- **Big outputs go to `$CLUSTERING_BUILD`**, never to the root filesystem.
- Run long jobs with `python3 -u` and a log file, or buffered output makes a long run look
  like a silent failure.

## After ANY re-clustering: derived artefacts that do not rebuild themselves

A matview refresh (`docs/runbooks/post-load-refresh.md`) rebuilds the materialized views.
Everything below is **outside** it, so a re-cluster leaves it holding the previous
clustering's numbers — with no error and no empty state.

| artefact | rebuild with | symptom if skipped |
|---|---|---|
| `gcf_taxonomy_distribution_mv` (a plain TABLE) | `backfill_taxonomy_dist.sql`, then **ANALYZE** | /gcfs shows "No data" on every row |
| `gcf_route_counts_mv` | `REFRESH MATERIALIZED VIEW CONCURRENTLY gcf_route_counts_mv` | "Assignment statistics" shows the old routes, or the panel hides on families that now have derived members |
| the three browse indexes | `build_browse_corpus.py` + versioned reindex + alias promote | gcf/bgc/sample lists serve stale families |
| `bgc_facets` | `resolve_facets.py` + versioned index + alias swap (`scripts/populator/tools/`) | Property Search filters and the distance histogram answer from the old clustering |
| chart snapshots | `generate-map-snapshot.ts` and the chart snapshot scripts | /gcfs draws old numbers under new headlines |
| Redis | delete `gcf-cooccurrence*`, `gcf*detail*`, `stats:global:*` with a `while IFS= read -r` loop — **not** `--scan \| xargs DEL`, which eats keys containing quotes and braces | cached payloads outlive the data |
| the two BiG-SLiCE query caches | `scripts/bigslice-query/build_gcf_model_cache.py` for **both** workspaces, then `verify_gcf_model_cache.py` | the Search page's BGC-clustering tab answers from the PREVIOUS clustering's centroids — see below |

### The BiG-SLiCE query caches, specifically

`bigslice-query/{seed,residual}/result/cache/gcf_models_1.pkl` hold the GCF centroids.
They are the one artefact here that a re-cluster makes **actively wrong** rather than
merely stale, because the family ids keep resolving:

- the search queries the old centroids and gets an old family's integer id back,
- `atlasGcfName()` turns that id into a name, which resolves against the NEW `gcfs`
  table to an unrelated family,
- which renders as a confident hit, with a pet name, a member count and a working link.

Nothing errors and nothing looks empty. Rebuild both caches (`scripts/bigslice-query/`),
and before relying on them, query a sample of BGCs the clustering itself placed and check
that the same family and distance come back.

Also re-point `BIGSLICE_SEED_DIR` / `BIGSLICE_RESIDUAL_DIR` if the new bundle lands in a
new path, and restart the app so it picks them up.

Run `ANALYZE` after any TRUNCATE+INSERT rebuild: without fresh statistics the planner
picks plans that are orders of magnitude slower on identical data.
