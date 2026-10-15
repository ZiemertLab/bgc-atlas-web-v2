#!/usr/bin/env bash
# Cron wrapper: refreshes every view in REFRESH_TIERS (src/lib/refresh-tiers.ts)
# in tier order, then busts and re-warms the statistics caches in Redis.
#
# Each view is its own psql call/transaction: one long transaction over many
# REFRESHes can OOM-kill postgres. Do not raise work_mem for this job.
# A failed view doesn't stop the run, but tier N+1 is then built from stale
# input, so re-run from the failed tier. A full run takes ~93 min.
#
# Usage: REFRESH_VIEWS_ROOT=<repo>/bgc-atlas refresh-views-cron.sh
#
# Crontab (weekly, Saturday 22:00):
#   0 22 * * 6 REFRESH_VIEWS_ROOT=<repo>/bgc-atlas <repo>/bgc-atlas/scripts/refresh-views-cron.sh > ~/refresh-views.log 2>&1
set -uo pipefail

# ROOT is where .env lives; set REFRESH_VIEWS_ROOT for a copy installed elsewhere.
ROOT="${REFRESH_VIEWS_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
if [ ! -f "$ROOT/.env" ]; then
  echo "refresh-views: no .env at $ROOT -- set REFRESH_VIEWS_ROOT to the bgc-atlas dir" >&2
  exit 1
fi
cd "$ROOT"

BASE_URL="${WARM_BASE_URL:-http://localhost:3001}"
REDIS_DB_NUM="$(grep -hoE 'REDIS_DB="[^"]*"' .env | head -1 | sed -E 's/REDIS_DB="(.*)"/\1/')"
REDIS_DB_NUM="${REDIS_DB_NUM:-0}"

DB="$(grep -hoE 'DATABASE_URL="[^"]*"' .env | head -1 | sed -E 's/DATABASE_URL="(.*)"/\1/')"
if [ -z "$DB" ]; then
  echo "refresh-views: could not read DATABASE_URL from $ROOT/.env" >&2
  exit 1
fi

echo "refresh-views: starting $(date -Is)"

# Node (v22.18+) strips types natively. cron's PATH may lack node: set NODE_BIN.
NODE_BIN="${NODE_BIN:-$(command -v node)}"
TIERS_FILE="$ROOT/src/lib/refresh-tiers.ts"
if ! LIST="$("$NODE_BIN" --no-warnings -e "
  import('$TIERS_FILE').then((m) => {
    m.REFRESH_TIERS.forEach((t, i) => t.forEach((v) => console.log((i + 1) + ' ' + v)));
  })")" || [ -z "$LIST" ]; then
  echo "refresh-views: could not read REFRESH_TIERS from $TIERS_FILE" >&2
  exit 1
fi

# The app's statement_timeout must not apply to this maintenance job.
start=$SECONDS
failed=()
refreshed=0
while read -r tier view; do
  t0=$SECONDS
  if /usr/bin/psql "$DB" -X -q -At -v ON_ERROR_STOP=1 \
       -c 'SET statement_timeout = 0;' \
       -c "SELECT admin_refresh_matview('$view');" > /dev/null; then
    refreshed=$((refreshed + 1))
    echo "refresh-views: tier $tier ok    $((SECONDS - t0))s  $view"
  else
    failed+=("$view")
    echo "refresh-views: tier $tier FAIL  $((SECONDS - t0))s  $view" >&2
  fi
done <<< "$LIST"
echo "refresh-views: refreshed $refreshed/$((refreshed + ${#failed[@]})) in $((SECONDS - start))s"

# A live matview missing from REFRESH_TIERS is never refreshed. `_preNNNN`
# rollback copies are expected to be absent.
LIVE="$(/usr/bin/psql "$DB" -X -At -c "SELECT matviewname FROM pg_matviews WHERE schemaname = 'public'")"
untracked="$(comm -23 <(printf '%s\n' "$LIVE" | grep -vE '_pre[0-9]{4}$' | sort) \
                      <(awk '{print $2}' <<< "$LIST" | sort))"
if [ -n "$untracked" ]; then
  echo "refresh-views: NOT IN REFRESH_TIERS, never refreshed: $(echo $untracked)" >&2
fi

# Keep in sync with STATS_CACHE_PATTERNS in src/lib/stats-cache.ts.
# statistics:bgcs:* has a 300s TTL and is omitted from both.
PATTERNS=(
  'stats:global:*'
  'stats:gcfs:global'
  'statistics:samples:*'
  'statistics:genomes:*'
  'gcf:stats'
)
busted=0
for pattern in "${PATTERNS[@]}"; do
  # Not xargs: keys contain JSON with quotes and spaces.
  while IFS= read -r key; do
    [ -z "$key" ] && continue
    redis-cli -n "$REDIS_DB_NUM" DEL "$key" > /dev/null && busted=$((busted + 1))
  done < <(redis-cli -n "$REDIS_DB_NUM" --scan --pattern "$pattern" 2>/dev/null)
done
echo "refresh-views: busted $busted stats cache keys"

# Keep in sync with STATS_WARM_PATHS in src/lib/stats-cache.ts.
PATHS=(
  "/api/statistics"
  "/api/statistics?sourceType=metagenome"
  "/api/statistics?sourceType=isolate&sourceType=MAG&sourceType=SAG"
  "/api/statistics/gcfs"
  "/api/statistics/samples"
  "/api/statistics/genomes/taxonomy-hierarchy"
  "/api/gcfs/stats"
)
failures=0
for path in "${PATHS[@]}"; do
  read -r code time < <(curl -s -o /dev/null \
    -w '%{http_code} %{time_total}' --max-time 300 "${BASE_URL}${path}" || echo "000 0")
  if [ "$code" = "200" ]; then
    echo "refresh-views: warm ok    ${code} ${time}s  ${path}"
  else
    echo "refresh-views: warm FAIL  ${code} ${time}s  ${path}" >&2
    failures=$((failures + 1))
  fi
done

echo "refresh-views: done in $((SECONDS - start))s $(date -Is)"
# Caches are busted and re-warmed even after a failed view; every problem still
# exits non-zero so cron mail surfaces it.
if [ "${#failed[@]}" -gt 0 ]; then
  echo "refresh-views: ${#failed[@]} view(s) FAILED: ${failed[*]}" >&2
  exit 1
fi
[ -n "$untracked" ] && exit 1
[ "$failures" -gt 0 ] && exit 1
exit 0
