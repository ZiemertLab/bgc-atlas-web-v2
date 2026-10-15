# scripts/clustering-v3/pipeline

The HPC pipeline that produces the GCF clustering. Its outputs, under the work dir `$V`:

- `bigslice-output-v3/result/data.db` — BiG-SLiCE model of the main families (threshold 0.4)
- `bigslice-output-residual-v3/result/data.db` — residual families (clustering 1 = 0.4, 2 = 0.7)
- `hac-v3/` — HAC linkages and `gcf_to_levels_{ward,average}.parquet` (L2 … L1000)
- `master/master_atlas_v3.parquet` — one row per BGC: route, `gcf_04`, `gcf_04_all`,
  `hac_L*`, `residual_gcf_04`, `residual_route`, `residual_confident_04`

The final master is `master_atlas_v3.parquet`, folded in place by the later stages; the
downstream build (`../build_*.py`) reads it. The two `data.db` files are what
`../extract_data_db.sh` and `scripts/bigslice-query/` use.

## Setup

- Deploy: copy the top-level scripts here to `$V/scripts/v3/` and each subdirectory
  (`dedup/`, `orphan/`, `containment/`, `features/`, `scoring/`) to `$V/scripts/<dir>/`; the jobs call them
  by those paths.
- `V=/work/atlas-clustering-v2` (`WORK` in the Python files) is hard-coded in every script;
  edit it for your work dir.
- `CB=${CB:-/opt/miniforge3}` is the conda base. Envs used: `atlas-clustering` (Python:
  polars, pyarrow, numpy, scipy, biopython), `bigslice2` (BiG-SLiCE 2.0), `mmseqs2`, `seqkit`.
  Also needed: `pigz`, GNU `/usr/bin/time`, and the `sqlite3` CLI for the pilots.
- Inputs that must already exist: `$V/input/all_regions_gbk.tar.gz` (flat `<uuid>.gbk`
  antiSMASH regions, the published archive from `scripts/export/repack_regions_gbk.py`),
  `$V/input/regions_nuc.fasta` (from `scripts/populator/tools/extract_sequences.py`), `$V/input/bgc_uuid_source.parquet`
  (bgc_id → source/sample, the database export published in the downloads); and the MIBiG
  antiSMASH GBKs under `$V/mibig-antismash-4.0/`.
- `.sh` files are SLURM jobs (`sbatch`); the array jobs expect a node-local `$TMPDIR`.
  `scan_features.sh`, `run_bigslice*_v3.sh` and `build_hac_v3.sh` request ~1.9 TB of memory.
  `.py` files without a `.sh` wrapper are run directly in `atlas-clustering`.

## Run order

Each step reads files written by the one before it.

0. **Features** — `features/scan_features.sh` (decompresses the tar, runs `scan_tar.py` with
   `parse_gbk.py`) → `features/index_tar.sh` (writes `input/tar_index.parquet`; needs only the
   decompressed tar) → `features/concat_features.sh` (writes `features/features.parquet`) →
   `scoring/add_completeness.py` (adds `primary_category`, `completeness_class` and
   `hybrid_structure`, which the seed and containment steps read)
1. **Seed clustering** — `subset_hashdedup_v3.sh` (runs `export_seed_v3.py` and
   `dedup/hash_dedup.py`) →
   `run_linclust_v3.sh` → `pick_reps_v3.py` → `build_bigslice_input_v3.sh` → `run_bigslice_v3.sh`
2. **HAC** (needs only step 1) — `build_hac_v3.sh` (centroids + linkage) → `cut_hac_tree_v3.py`
3. **Containment** (needs step 1) — `build_containment_v3.sh` (runs `export_query_ids_v3.py`,
   `containment/extract_mibig_nuc.py` if needed; MIBiG targets are only the entries in the seed
   run) → `run_easy_search_v3.sh` → `propagate_hits_v3.py` → `containment_multifamily_v3.py`.
   A BGC is contained when at least 80% of the whole BGC aligns to a target at ≥90% identity
   (`--max-seq-len`, see the comment in `run_easy_search_v3.sh`).
4. **Orphan query** — `export_orphans_v3.py` → `run_orphan_query_v3.sh` (60-task array,
   parses with `orphan/parse_query.py`) →
   `concat_orphan_v3.py --out $V/orphan-v3/orphan_assignments.parquet`
5. **Master table** — `build_master_table_v3.sh` (needs 1–4) → `build_master_mf_v3.sh`
6. **Residual clustering** of unplaced core-complete/partial BGCs — `subset_hashdedup_residual_v3.sh`
   (runs `export_residual_v3.py`) → `run_linclust_residual_v3.sh` → `pick_reps_residual_v3.py` →
   `build_bigslice_input_residual_v3.sh` → `run_bigslice_residual_v3.sh` → `fold_residual_master_v3.sh`
7. **Residual containment** — `build_residcont_v3.sh` → `run_easy_search_residcont_v3.sh` →
   `propagate_residcont_v3.py` → `fold_residcont_master_v3.py`
8. **Residual orphan query** — `export_orphans_residcont_v3.py` → `run_orphan_residcont_v3.sh`
   (array) → `concat_residq_v3.py` → `fold_residq_master_v3.py`
9. **Taxonomy** (optional) — `join_master_tax_v3.py` writes `master_atlas_tax_v3.parquet`, the
   master plus `tax_*` columns from `scripts/taxonomy/`. The downstream build reads either file.

Steps 5–8 rewrite `master_atlas_v3.parquet` in place. `build_master_table_v3.sh` rebuilds it
from scratch, so every later step must be rerun after it; the fold steps are not idempotent
(rerunning `fold_residcont_master_v3.py` relabels contained fragments as `residual_seed`).

## Optional diagnostics

- `pilot_orphan_ranks.sh`, `pilot_residual_query.sh` — inspect BiG-SLiCE query-mode output
  on a 3,000-BGC sample.
- `analyze_residual_v3.py` — counts confident new families per residual clustering.
- `run_orphan_query_multi_v3.sh` with `parse_query_multi_v3.py` — re-runs the orphan query
  keeping every GCF within 0.4 (writes `orphan-v3/assignments_multi/`). Nothing in this
  directory reads that output (unclear from the scripts whether it fed the master).
