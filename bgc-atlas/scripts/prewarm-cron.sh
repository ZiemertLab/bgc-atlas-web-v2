#!/usr/bin/env bash
# Cron wrapper: loads DATABASE_URL from the app .env and runs a prewarm SQL script.
#
# Usage: prewarm-cron.sh [sql-file-under-scripts]   (default: prewarm-hot-caches.sql)
#
# Crontab (index tier hourly, heap tier daily; append so failures leave history):
#    0 * * * *  <repo>/bgc-atlas/scripts/prewarm-cron.sh prewarm-tier1.sql >> ~/prewarm-tier1.log 2>&1
#   30 4 * * *  <repo>/bgc-atlas/scripts/prewarm-cron.sh prewarm-tier2.sql >> ~/prewarm-tier2.log 2>&1
set -euo pipefail

SQL_FILE="${1:-prewarm-hot-caches.sql}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ ! -f "scripts/$SQL_FILE" ]; then
  echo "prewarm-cron: scripts/$SQL_FILE not found under $ROOT" >&2
  exit 1
fi

DB="$(grep -hoE 'DATABASE_URL="[^"]*"' .env | head -1 | sed -E 's/DATABASE_URL="(.*)"/\1/')"
if [ -z "$DB" ]; then
  echo "prewarm-cron: could not read DATABASE_URL from $ROOT/.env" >&2
  exit 1
fi

echo "=== $(date -Is) prewarm $SQL_FILE"
status=0
/usr/bin/psql "$DB" -v ON_ERROR_STOP=1 -f "scripts/$SQL_FILE" || status=$?
echo "=== $(date -Is) prewarm $SQL_FILE exit=$status"
exit "$status"
