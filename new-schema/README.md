# new-schema

The database schema as a baseline, plus the data steps a fresh load needs.

```
roles.sql                              bgc_owner + bgc_app, no passwords
migrations/0000_baseline_pre_data.sql  extensions, tables, functions, views, matviews (WITH NO DATA)
migrations/9000_baseline_post_data.sql primary/foreign keys, indexes, triggers, grants
seed/seed_reference.sql                data_sources, product_category_map
seed/bgc_redirect.csv.gz               356,305 retired MGnify BGC ids -> their surviving twin
load-staging/                          staging tables a loader needs that the baseline lacks
postload/                              data corrections to re-apply after a fresh population
```

## The baseline

A `pg_dump --schema-only --no-owner` of the production schema, split with
`--section=pre-data` / `--section=post-data` so bulk loads run before the
indexes and keys exist. It replaces the numbered migrations that built that
schema, which interleave data loads with schema changes and do not replay on an
empty database.

**New schema changes** go in `migrations/` as numbered files from `0127_`
onwards, applied in order with
`psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f <file>`. There is no runner and no
tracking table.

## Applying it

```bash
psql -U postgres -f roles.sql
createdb -U postgres -O bgc_owner bgc_atlas_v2
psql -U postgres -d bgc_atlas_v2 -c 'CREATE EXTENSION IF NOT EXISTS pg_prewarm'

export DB="postgresql://bgc_owner:...@localhost:5432/bgc_atlas_v2"
psql "$DB" -v ON_ERROR_STOP=1 -f migrations/0000_baseline_pre_data.sql
psql "$DB" -v ON_ERROR_STOP=1 -f seed/seed_reference.sql
zcat seed/bgc_redirect.csv.gz | psql "$DB" -c "\copy bgc_redirect FROM stdin WITH (FORMAT csv, HEADER true)"

# ... bulk loads (see the top-level README) ...

psql "$DB" -v ON_ERROR_STOP=1 -f migrations/9000_baseline_post_data.sql
```

The post-data file adds every foreign key, so it is also the first check that
the loads are mutually consistent. `bgc_redirect` has no foreign keys: its old
ids are deliberately absent from `bgcs`.

## load-staging/

`0071_taxonomy_v2_schema.sql` creates the `tax_stage_*` tables that
`scripts/clustering-v2/load_taxonomy_v2.sh` copies into. It is idempotent
(`IF NOT EXISTS`) and skips `bgc_taxonomy`, which the baseline already has.
Drop the stage tables after the load:

```sql
DROP TABLE IF EXISTS tax_stage_lineages, tax_stage_pred, tax_stage_gtdb, tmp_gtdb_bgc;
```

Clustering needs no staging on a fresh database: copy its four CSVs straight
into `gcfs`, `bgc_gcf` and `bgc_features` before the post-data
file (the commands are in the top-level README, step 3).

## postload/

Migrations that changed **data**, not schema, and that a fresh population can
undo by re-deriving the uncorrected values. Copied verbatim. Apply them after
the loads and backfills, in this order. Each is idempotent and states its
reasoning in its header.

| file | what it corrects | run after |
|---|---|---|
| `0076b_split_wwtp_and_mining_paths.sql` | WWTP and mining GOLD paths split by sample | GOLD backfills |
| `0077b_lab_controls_are_not_ecosystems.sql` | lab controls carrying their study's ecosystem | GOLD backfills |
| `0078_amd_isolation_source_overrides_envo_feature.sql` | acid-mine-drainage samples routed by a generic ENVO feature | GOLD backfills |
| `0083_drop_non_redistributable_abstracts.sql` | deletes abstracts we may not republish and sets `abstract_withheld` | every study-abstract backfill. **Legal, not cosmetic**: the studies table ships in the public download |
| `0084_custom_study_center_names.sql` | publisher written into `center_name` for four custom studies | `backfill_custom_studies.py`, `study_bgc_summary` |
| `0101_ziemert_second_doi.sql` | second Ziemert Lab DOI | `backfill_custom_studies.py` |
| `0121_genome_qc_provenance.sql` | CheckM tool/source per genome | `tools/backfill_genome_qc.sql` |
| `0122_gtdb_checkm2_label.sql` | GTDB QC is CheckM2, not CheckM | 0121 |
| `0129a_remove_culled_genomes.sql` | removes the 46,098 culled genomes listed in `0129a_culled_genomes.tsv.gz` (duplicate copies, MIMAG-low quality, identical copies; 166,457 BGCs), keyed on `samples.external_id`. Run from the repo root | `tools/load_uniform_checkm2.sql` and before the clustering load: top-level README step 2b |
