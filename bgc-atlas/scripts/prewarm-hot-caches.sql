-- Prewarm the hot lookup paths for /api/bgcs/[id]. The working set exceeds RAM
-- and cold random reads cost ~600ms each, so a cold detail row takes ~1-2s.
--   Tier 1 (prewarm-tier1.sql): index-descent path + small tables -> shared_buffers.
--   Tier 2 (prewarm-tier2.sql): large heaps -> OS page cache.
--
-- This file runs both tiers (e.g. after a Postgres restart):
--   psql "$DATABASE_URL" -f scripts/prewarm-hot-caches.sql
-- Cron runs the tiers separately via scripts/prewarm-cron.sh.
--
-- Read-only and sequential. After a data reload, also flush: redis-cli ... DEL bgcs:detail:*

\ir prewarm-tier1.sql
\ir prewarm-tier2.sql
