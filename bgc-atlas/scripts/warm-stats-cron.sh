#!/usr/bin/env bash
# Cron wrapper that keeps the statistics Redis caches warm, covering evictions
# and restarts between view refreshes.
#
# Usage: warm-stats-cron.sh
#        WARM_BASE_URL=... warm-stats-cron.sh
#
# Crontab (hourly):
#   15 * * * * <repo>/bgc-atlas/scripts/warm-stats-cron.sh > ~/warm-stats.log 2>&1
set -uo pipefail

# Base URL including basePath.
BASE_URL="${WARM_BASE_URL:-http://localhost:3001}"

# Keep in sync with STATS_WARM_PATHS in src/lib/stats-cache.ts.
PATHS=(
  "/api/statistics"
  "/api/statistics?sourceType=metagenome"
  "/api/statistics?sourceType=isolate&sourceType=MAG&sourceType=SAG"
  "/api/statistics/gcfs"
  "/api/statistics/samples"
  "/api/gcfs/stats"
)

failures=0
for path in "${PATHS[@]}"; do
  read -r code time < <(curl -s -o /dev/null \
    -w '%{http_code} %{time_total}' --max-time 60 "${BASE_URL}${path}" || echo "000 0")
  if [ "$code" = "200" ]; then
    echo "warm-stats: ok    ${code} ${time}s  ${path}"
  else
    echo "warm-stats: FAIL  ${code} ${time}s  ${path}" >&2
    failures=$((failures + 1))
  fi
done

if [ "$failures" -gt 0 ]; then
  echo "warm-stats: ${failures}/${#PATHS[@]} endpoints failed" >&2
  exit 1
fi
echo "warm-stats: all ${#PATHS[@]} endpoints warm"
