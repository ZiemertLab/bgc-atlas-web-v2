-- 0083_drop_non_redistributable_abstracts.sql
-- Delete abstract text we are not licensed to republish. Hiding it in the UI is not
-- enough: `studies` ships in the public DB snapshot (export_db_snapshot.py).
-- Provenance columns (abstract_doi/_publisher/_license) are kept for the credit link.
--
-- abstract_withheld is a tombstone: without it the fill-only backfills
-- (COALESCE(s.abstract, v.abstract)) would refetch the deleted text.

BEGIN;

ALTER TABLE studies ADD COLUMN IF NOT EXISTS abstract_withheld boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN studies.abstract_withheld IS
  'True when an abstract was held and then deleted as not redistributable. Distinguishes a deliberate removal from a study that simply has no abstract; the fill-only backfills must not refetch text for these rows.';

-- Mirrors canShowAbstract() in src/lib/abstract-license.ts.
UPDATE studies
   SET abstract          = NULL,
       abstract_withheld = true,
       updated_at        = now()
 WHERE abstract IS NOT NULL
   AND (abstract_source IS NULL
        OR (abstract_source IN ('crossref', 'europepmc')
            AND (abstract_license IS NULL
                 OR abstract_license !~* 'creativecommons\.org/(licenses|publicdomain)/')));

COMMIT;
