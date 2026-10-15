-- Roles the baseline expects. Run once per cluster, as a superuser, before
-- migrations/0000_baseline_pre_data.sql.
--
--   bgc_owner  owns every object and runs migrations, loads and refreshes. The
--             baseline must be applied as this role (default privileges are FOR ROLE bgc_owner).
--   bgc_app   the web app's login (DATABASE_URL in bgc-atlas/.env.local).
--
-- No passwords here. Set them afterwards:
--   ALTER ROLE bgc_owner PASSWORD '...';
--   ALTER ROLE bgc_app  PASSWORD '...';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bgc_owner') THEN
    CREATE ROLE bgc_owner LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bgc_app') THEN
    CREATE ROLE bgc_app LOGIN;
  END IF;
END
$$;

-- CREATE DATABASE bgc_atlas_v2 OWNER bgc_owner;
-- pg_prewarm needs a superuser, so create it first if bgc_owner is not one:
--   \c bgc_atlas_v2
--   CREATE EXTENSION IF NOT EXISTS pg_prewarm;
