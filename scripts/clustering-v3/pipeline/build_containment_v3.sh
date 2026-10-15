#!/usr/bin/env bash
#SBATCH --job-name=v3-containment-build
#SBATCH --partition=compute
#SBATCH --nodes=1
#SBATCH --cpus-per-task=32
#SBATCH --mem=64G
#SBATCH --time=12:00:00
#SBATCH --output=/work/atlas-clustering-v2/logs/%x_%j.out
#SBATCH --error=/work/atlas-clustering-v2/logs/%x_%j.err
# Containment prep: queries = BGCs outside the seed clustering, targets = seed reps + the MIBiG
# entries in the seed clustering (so it needs the seed BiG-SLiCE run, step 1).
# No mmseqs createindex: it runs out of memory at this scale and easy-search indexes itself.
set -euo pipefail
V=/work/atlas-clustering-v2
CB=${CB:-/opt/miniforge3}
SEQKIT="$CB/envs/seqkit/bin/seqkit"
MMSEQS="$CB/envs/mmseqs2/bin/mmseqs"
NUC="$V/input/regions_nuc.fasta"
C="$V/containment-v3"
MIBNUC="$V/containment/mibig_nuc.fasta"
source "$CB/etc/profile.d/conda.sh"; conda activate atlas-clustering

echo "[$(date '+%F %T')] 1) export query + rep ids"
python "$V/scripts/v3/export_query_ids_v3.py"

echo "[$(date '+%F %T')] 2) seqkit grep queries -> queries.fasta"
"$SEQKIT" grep -j 32 -f "$C/query_ids.txt" "$NUC" -o "$C/queries.fasta"
echo "[$(date '+%F %T')] queries: $("$SEQKIT" stats -T "$C/queries.fasta" | tail -1)"

echo "[$(date '+%F %T')] 3) hash-dedup queries"
python "$V/scripts/dedup/hash_dedup.py" --in "$C/queries.fasta" \
  --out-fasta "$C/queries_unique.fasta" --out-membership "$C/queries_exact.parquet"

echo "[$(date '+%F %T')] 4) build targets = v3 reps + MIBiG"
"$SEQKIT" grep -j 32 -f "$C/rep_ids.txt" "$NUC" -o "$C/rep_targets.fasta"
[ -s "$MIBNUC" ] || python "$V/scripts/containment/extract_mibig_nuc.py"
# Only the MIBiG entries BiG-SLiCE parsed are in the seed run and have a family. A BGC whose
# only hit was one of the others would be marked contained without a GCF, so leave them out.
python - "$V/bigslice-output-v3/result/data.db" "$C/mibig_target_ids.txt" <<'PY'
import sqlite3, sys
con = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
ids = sorted(n.removeprefix("genomes/") for (n,) in con.execute(
    "SELECT b.name FROM bgc b JOIN dataset d ON d.id = b.dataset_id "
    "JOIN gcf_membership m ON m.bgc_id = b.id AND m.rank = 0 WHERE d.name = 'MIBiG'"))
open(sys.argv[2], "w").write("\n".join(ids) + "\n")
print(f"MIBiG containment targets: {len(ids):,} in the seed clustering")
PY
"$SEQKIT" grep -j 8 -f "$C/mibig_target_ids.txt" "$MIBNUC" -o "$C/mibig_targets.fasta"
cat "$C/rep_targets.fasta" "$C/mibig_targets.fasta" > "$C/targets.fasta"
echo "[$(date '+%F %T')] targets: $("$SEQKIT" stats -T "$C/targets.fasta" | tail -1)"

echo "[$(date '+%F %T')] 5) mmseqs createdb (no createindex)"
rm -f "$C"/targetsDB*
"$MMSEQS" createdb "$C/targets.fasta" "$C/targetsDB"
echo "[$(date '+%F %T')] done"
