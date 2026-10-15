# BGC Atlas

The BGC Atlas website and rebuild its data: the
Next.js app, the database schema, the scripts that populate PostgreSQL and
OpenSearch, and the jobs that keep them current.

```
bgc-atlas/        Next.js app (pm2: bgc-atlas-v2, 127.0.0.1:3001)
new-schema/       schema baseline, seed data, post-load corrections — see its README
scripts/          population, clustering, OpenSearch, downloads
docs/             runbooks (post-load refresh, data releases), release notes, static snapshots
```

Third-party data and assets we may not redistribute are gitignored. A fresh
clone needs them restored first: see `THIRD_PARTY.md`.

The app spawns `../scripts/trim_antismash_region.py`, so `bgc-atlas/` and
`scripts/` must stay siblings.

## What the site needs outside this repo

| | where | notes |
|---|---|---|
| PostgreSQL 18 | 
| Redis | 
| OpenSearch 2.19 | 
| Shared storage | the data root, `/data/bgc-atlas` below, mounted at the same path on the app host **and** the docker host | antiSMASH run tarballs (`antismash_runs.file_path`), `all_regions_gbk.tar.gz`, downloads, BiG-SLiCE workspaces, DIAMOND db |
| Python | `/data/bgc-atlas/miniforge3/bin/python3` | `ANTISMASH_PYTHON` default; needs `ijson` |

**Data root.** Scripts and code defaults write the shared storage as
`/data/bgc-atlas`. Mount or symlink it there, or set the per-path variables in
`bgc-atlas/.env.local.example` (`COMBINED_GBK_ARCHIVE`, `ANTISMASH_PYTHON`,
`BIGSLICE_SESSION_DIR`, `DIAMOND_PROTEIN_DB`, ...) and pass the scripts' path
arguments explicitly.

OpenSearch runs with its security plugin on: TLS from a private CA and a
read-only `bgc_reader` user for the app, `bgc_indexer` for builds. Setup, users
and password rotation are in `scripts/opensearch/README.md`. Every client reads
`OPENSEARCH_URL`, `OPENSEARCH_USERNAME`, `OPENSEARCH_PASSWORD` and
`OPENSEARCH_CA_CERT`; shell commands use `oscurl` from
`scripts/opensearch/oscurl.sh` instead of `curl`.

## Running the app

```bash
cd bgc-atlas
npm ci
npx prisma generate
npm run build
pm2 start ecosystem.config.js        # or: pm2 restart bgc-atlas-v2
```

`.next` **is** the live build: `npm run build` in the served checkout replaces
it under the running server, and `npm run dev` there takes the site down. A
second checkout must set `SEARCH_WORKER_DISABLED=1`, or its worker joins the
production Redis queues. See `bgc-atlas/README.md`.

Cron (paths relative to this repo):

```
0 * * * *    bgc-atlas/scripts/prewarm-cron.sh prewarm-tier1.sql
30 4 * * *   bgc-atlas/scripts/prewarm-cron.sh prewarm-tier2.sql
15 * * * *   bgc-atlas/scripts/warm-stats-cron.sh
0 22 * * 6   REFRESH_VIEWS_ROOT=<repo>/bgc-atlas bgc-atlas/scripts/refresh-views-cron.sh
```

## Building the data from scratch

The order matters; each step reads what the ones before it wrote. Python tools
run as modules from the repo root, e.g.
`python -m scripts.populator.tools.build_assembly_taxonomy --check`. Every tool
documents its arguments and prerequisites in its docstring. Install
`scripts/populator/requirements.txt` into a venv. Heavy steps belong on the
compute nodes, not the app host.

**1. Schema.** `new-schema/README.md`: roles, `0000_baseline_pre_data.sql`,
seed data. Hold `9000_baseline_post_data.sql` until the bulk loads are in.

**1b. antiSMASH.** Region predictions come from metaSMASH runs on the HPC cluster
(`scripts/antismash/run_metasmash_array.sh`, one array task per assembly FASTA).
Genes are called with prodigal-m for metagenome assemblies and with prodigal in
single-genome mode for genomes: every MAG collection was run with
`GENEFINDING_TOOL=prodigal`, and the GTDB isolate genomes with antiSMASH's own
prodigal gene finding.

**2. Corpus.** `scripts/populator/`:

- `populate.py --config config.yaml --source <name>` per source (`custom`,
  `metalog`, `mgnify`, `gtdb`, `mag`, `owc`). It writes validated TSV/parquet
  plus a manifest. Start from `config.example.yaml`. The gtdb adapter reads
  per-region GBK directories; `prep/extract_antismash_tar_native.sh` extracts
  them from the antiSMASH tarballs.
- Generate the `\copy` script with `tools/combined_load.py --out DIR SRC_DIR...`
  (merges the source dirs and deduplicates shared lookup rows) and run it;
  `tools/load_mag_collections.py` does the same for the MAG catalogs.
- Load `mgnify` before `mgnify_new` and `metalog_added`: both attach to studies
  and assemblies it creates.
- New datasets later, into a loaded database: `tools/load_cohort.py` writes a
  guarded, append-only load and its exact rollback for one staged populator dir.
- MGnify v2 metadata: `scripts/mgnify_v2_crawl/` -> `tools/emit_mgnify_v2.py`
  -> `tools/patch_mgnify_v2.py`.

**2b. Genome QC and the cull**, before the clustering: the clustering was built
without the culled genomes, and the QC load needs every genome it names.

```bash
export PGOPTIONS='-c statement_timeout=0'
psql "$DB" -v ON_ERROR_STOP=1 -f scripts/populator/tools/backfill_genome_qc.sql        # published CheckM values
psql "$DB" -v ON_ERROR_STOP=1 -f scripts/populator/tools/load_uniform_checkm2.sql      # our CheckM2 1.1.0 run, non-GTDB genomes
psql "$DB" -v ON_ERROR_STOP=1 -f new-schema/postload/0129a_remove_culled_genomes.sql   # 46,098 duplicate / low-quality genomes
```

On an already-indexed database, carry QC changes into `sample_browse` with
`build_sample_qc_map.sh` and `gcf_scalar_patch.py ... --id-field sample_id --alias sample_browse`.

**3. Clustering.** `scripts/clustering-v3/pipeline/` runs the clustering itself
on the HPC cluster (BiG-SLiCE, MMseqs2, HAC) and produces the master table; see
its README. `scripts/clustering-v3/` turns that into load CSVs (order in its README;
the identity reduction also runs on the HPC cluster). Then load them, before the
post-data file so no index is maintained during the copy:

```sql
\copy gcfs (id, name, pet_name, family_class, listed, n_bgc, dom_category, cluster_method, representative_bgc_id) FROM '<out>/gcfs.csv' WITH (FORMAT csv, HEADER true)
\copy bgc_gcf (bgc_id, gcf_id, distance, is_primary, rank) FROM '<out>/bgc_gcf.csv' WITH (FORMAT csv, HEADER true)
\copy bgc_features FROM '<out>/bgc_features.csv' WITH (FORMAT csv, HEADER true)
```

Earlier clusterings live on as `gcf_legacy` (retired families, so their pages and
names keep resolving) and `gcf_successor` (old family -> new families). A fresh
build cannot regenerate them; load them from the latest data release's `db/`
tables (`/downloads/db/`), with the column lists in
`scripts/clustering-v3/build_gcf_successor.py`. A rebuild without them serves the
current families only.

A `\copy` of millions of rows outlives the app DSN's 120 s statement timeout;
run these with `PGOPTIONS='-c statement_timeout=0'`.

**4. Keys and indexes.** `new-schema/migrations/9000_baseline_post_data.sql`.

**5. Taxonomy.** Per-BGC MMseqs2/GTDB calls from `scripts/taxonomy/` (HPC; see its
README), then `new-schema/load-staging/0071_taxonomy_v2_schema.sql`, then
`scripts/clustering-v2/build_taxonomy_v2.py` and `load_taxonomy_v2.sh`, the only
producer of `bgc_taxonomy`. See known gaps.

**6. Backfills.** Despite the name, each tool below is the **only** producer of
something the site shows. Run all of them after a fresh load:

- GTDB samples: `backfill_gtdb_metadata`, `backfill_gtdb_geo`,
  `backfill_gtdb_biosample`, `backfill_gtdb_studies`, `backfill_gtdb_ena_geo`,
  `backfill_gtdb_archaea_metadata.sql`, `backfill_gtdb_ecosystem`.
  The NCBI crawlers, `fetch_gtdb_release_metadata.sh` and
  `build_gtdb_enrichment_sidecar.py` regenerate their inputs.
- Genomes: `backfill_omd_geno_source_type` (input:
  `crawl_ncbi_assembly_reports`),
  and genome QC (step 2b).
- Ecosystem classification: `scripts/backfill_gold_ecosystem.py`,
  `backfill_envo_from_gold`, `backfill_spire_envo`, `backfill_soil_subtype`,
  `backfill_smag_soil_subtype`, `backfill_aquatic_subtype`,
  `reclassify_animal_host`, `reclassify_aquatic_sediment`, then
  `normalize_gold_paths --apply` (the backfills write `samples` directly, so the
  ingest-time normalizer never sees their output) and refresh the views it prints.
- Studies: `backfill_custom_studies`, `backfill_customs_metadata`,
  `backfill_metalog_study_metadata`, `backfill_mgnify_study_metadata`,
  `backfill_mgnify_study_samples`, `backfill_abstract_provenance`.

**7. Corrections.** `new-schema/postload/` in the order its README gives.
0083 (non-redistributable abstracts) must follow every abstract backfill.

**8. Derived tables.**

- `scripts/mibig/build_gcf_mibig_anchor.py` -> `gcf_mibig_anchor`
- `scripts/populator/tools/study_bgc_summary/` -> `study_bgc_summary`,
  `study_gcf`, `gcf_study_count`
- `scripts/clustering-v3/backfill_taxonomy_dist.sql` ->
  `gcf_taxonomy_distribution_mv` (a table)
- `scripts/clustering-v3/build_cooccurrence_stats.sql` and
  `tools/recompute_cooccurrence.py`
- `bgc-atlas/scripts/backfill-gcf-pet-names.ts`, if the clustering output
  carries no pet names

**9. Materialized views.** All 34 come out of the baseline unpopulated, and
`REFRESH ... CONCURRENTLY` (what the weekly refresh script uses)
refuses an unpopulated view. Do the first refresh plainly, in tier order:

```bash
cd bgc-atlas
node --no-warnings --input-type=module -e "
  const {REFRESH_TIERS} = await import('./src/lib/refresh-tiers.ts');
  for (const t of REFRESH_TIERS) for (const v of t) console.log('REFRESH MATERIALIZED VIEW ' + v + ';');" \
  > /tmp/first-refresh.sql
PGOPTIONS='-c statement_timeout=0 -c max_parallel_workers_per_gather=0' \
  psql "$DB" -v ON_ERROR_STOP=1 -f /tmp/first-refresh.sql
```

Then `python -m scripts.populator.tools.build_assembly_taxonomy --apply` (it
gates against tier 1). After this, `docs/runbooks/post-load-refresh.md` covers
every later load.

**10. Region GBK archive.** `scripts/export/repack_regions_gbk.py` ->
`load_gbk_offsets.sql` (fills `bgc_gbk_offsets`) -> `publish_gbk_index.sh`.
Single-BGC downloads read the archive by these offsets.

**11. OpenSearch.** As `bgc_indexer` (`scripts/opensearch/README.md`), with `scripts/populator/tools/`:

- Browse, per entity `bgcs|gcfs|samples`: `build_browse_corpus.py --entity E --out X.ndjson.gz`
  -> `browse_index_lifecycle.py create E <ver>` -> `os_bulk_load_parallel.py`
  -> `browse_index_lifecycle.py promote E <ver> --expected-count N`.
- Property-search facets: `extract_facets_shard.py` on the compute nodes
  (reads the antiSMASH tarballs, no DB) -> `resolve_facets.py` here -> create
  the index with `facet_index_mapping.json` -> `os_bulk_load_parallel.py` ->
  move the `bgc_facets` alias -> `build_facet_vocab.py`.

The corpus builders project every field that was once patched in place, so a
fresh build needs no patch tools.

**12. Search back ends.**

- BiG-SLiCE: put `docker/bigslice/` plus `bigslice_models.tar.gz` (not in git)
  at `BIGSLICE_BUILD_CONTEXT`, and build the seed/residual workspaces' model
  caches with `scripts/bigslice-query/build_gcf_model_cache.py`. Without the
  cache, searches return wrong distances, not errors.
- DIAMOND: build the protein database with `scripts/seqsearch/build_diamond_db.sh`
  from the `regions_prot.faa` that `tools/extract_sequences.py` writes, and point
  `DIAMOND_PROTEIN_DB` at it.

**13. Static snapshots and downloads.** `bgc-atlas/scripts/generate-*-snapshot.ts`
(`docs/static-snapshots.md` explains the manifest scheme; they read OpenSearch,
so run them with `NODE_EXTRA_CA_CERTS` pointing at the cluster's CA), then
`scripts/export/export_db_snapshot.py`, `build_download_bundle.py` and
`build_clustering_bundle.py` for `/downloads`.

## Known gaps

A fresh rebuild hits these; the live database does not.

- `populate.py` ignores the GTDB `enrichment` sidecar key and never passes
  `genome_source_types` to the MAG adapter, which is why the step-6 GTDB and OMD
  backfills are still required.
