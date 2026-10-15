#!/bin/bash
# Export the core bgc_atlas_v2 tables for the public downloads page as per-table
# TSV.gz and one custom-format pg_dump. TABLES is an allowlist so internal
# session/user tables never leak.
#   PGPASSWORD=... export_db_tables.sh [db] [outdir]
set -euo pipefail
DB="${1:-bgc_atlas_v2}"
OUT="${2:-/data/bgc-atlas/data-v2/populator-out-sequences/db}"
HOST="${PGHOST:-localhost}"; USER="${PGUSER:-bgc_owner}"
mkdir -p "$OUT"

TABLES=(bgcs samples assemblies analyses antismash_runs
        gcfs taxonomies biomes data_sources studies runs
        mgnify_genomes mgnify_publications mgnify_super_studies mgnify_genome_catalogues
        sample_assemblies sample_analyses assembly_analyses study_samples
        sample_biomes sample_measurements sample_runs
        run_assemblies run_studies run_analyses)

echo "=== per-table TSV.gz @ $(date +%H:%M:%S) ==="
for t in "${TABLES[@]}"; do
  psql -h "$HOST" -U "$USER" -d "$DB" -X \
    -c "\copy $t TO STDOUT WITH (FORMAT csv, DELIMITER E'\t', HEADER true)" \
    | gzip -c > "$OUT/$t.tsv.gz"
  echo "  $t -> $(du -h "$OUT/$t.tsv.gz" | cut -f1)"
done

echo "=== pg_dump custom-format @ $(date +%H:%M:%S) ==="
targs=(); for t in "${TABLES[@]}"; do targs+=(-t "$t"); done
pg_dump -h "$HOST" -U "$USER" -d "$DB" -Fc "${targs[@]}" -f "$OUT/${DB}_core.dump"
echo "  ${DB}_core.dump -> $(du -h "$OUT/${DB}_core.dump" | cut -f1)"

echo "=== README + SHA256SUMS @ $(date +%H:%M:%S) ==="
cat > "$OUT/README.txt" <<EOF
BGC Atlas — core data tables ($DB), snapshot $(date +%Y-%m-%d)

Two forms of the same core relational tables:
  <table>.tsv.gz    tab-separated, header row, gzip-compressed. Load e.g.
                    pandas.read_csv(path, sep='\t')  |  DuckDB read_csv_auto(path)
  ${DB}_core.dump   PostgreSQL custom-format dump (schema + data + constraints):
                    createdb mydb && pg_restore --no-owner -d mydb ${DB}_core.dump

Tables (${#TABLES[@]}): ${TABLES[*]}

EXCLUDED: derived materialized views (GCF cooccurrence/distributions, per-BGC
biome summaries) and all internal session/user tables.
Verify downloads: sha256sum -c SHA256SUMS
EOF
( cd "$OUT" && sha256sum *.tsv.gz *.dump README.txt > SHA256SUMS )
echo "=== DB EXPORT DONE @ $(date +%H:%M:%S) === total: $(du -sh "$OUT" | cut -f1)"
