# Post-load refresh runbook

What to rebuild, and in what order, after anything writes to `bgcs`, `samples`,
`assemblies`, `bgc_gcf` or `bgc_taxonomy` — an ingest, a backfill, a clustering
reload. This is the routine path, with the site up.

---

## 0. `bgc-atlas/scripts/refresh-views-cron.sh`

The weekly cron job, and the way to run the whole refresh by hand. It walks
every matview in the tier order of §1 (read from `REFRESH_TIERS`), one
`REFRESH ... CONCURRENTLY` per transaction, then busts the Redis statistics
caches and re-warms the common variants. A failed view does not stop the run but
makes the exit status non-zero, since a partial refresh leaves the views
inconsistent with each other; re-run from the failed tier. It also reports any
live matview missing from `REFRESH_TIERS`.

```bash
REFRESH_VIEWS_ROOT=<repo>/bgc-atlas bgc-atlas/scripts/refresh-views-cron.sh
```

It reads `DATABASE_URL` and `REDIS_DB` from `bgc-atlas/.env`. The full set
contains a 12 GB rebuild and takes well over an hour; run it in a quiet window.

---

## 1. Materialized views

The matviews fall into 3 dependency tiers. `REFRESH_TIERS` in
`bgc-atlas/src/lib/refresh-tiers.ts` is the only list, and the script in §0
iterates it. Everything inside a tier is independent — run them in parallel if
you like; never start a tier before the one above it has finished. The order is
derived from the catalog with the queries in §7; re-derive it after adding a
matview rather than editing it by hand.

**Before you start**, in the same session:

```sql
SET max_parallel_workers_per_gather = 0;   -- stops work_mem being multiplied per worker
-- work_mem: leave it at the server default. If you raise it for speed, keep it
-- at 64MB or below; see §8.
```

### Tier 1 — read only base tables

```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY assembly_samples_mv;
REFRESH MATERIALIZED VIEW CONCURRENTLY bgc_product_category_distribution_mv;
REFRESH MATERIALIZED VIEW CONCURRENTLY bgc_gold_bucket_counts;
REFRESH MATERIALIZED VIEW CONCURRENTLY bgc_product_facet_counts;
REFRESH MATERIALIZED VIEW CONCURRENTLY data_source_statistics;
REFRESH MATERIALIZED VIEW CONCURRENTLY gcf_assembly_source_stats_mv;
REFRESH MATERIALIZED VIEW CONCURRENTLY gcf_length_stats_mv;
REFRESH MATERIALIZED VIEW CONCURRENTLY gcf_product_category_distribution_mv;
REFRESH MATERIALIZED VIEW CONCURRENTLY gcf_category_combination_mv;           -- one bgcs scan
REFRESH MATERIALIZED VIEW CONCURRENTLY gcf_product_type_matrix_mv;
REFRESH MATERIALIZED VIEW CONCURRENTLY gcf_route_counts_mv;
REFRESH MATERIALIZED VIEW CONCURRENTLY gcf_sample_map_mv;                     -- 5 GB, one of the slowest
REFRESH MATERIALIZED VIEW CONCURRENTLY gcf_summary_mv;                        -- the slowest
REFRESH MATERIALIZED VIEW CONCURRENTLY sample_biome_levels_mv;
REFRESH MATERIALIZED VIEW CONCURRENTLY sample_gcf_counts_mv;
REFRESH MATERIALIZED VIEW CONCURRENTLY sample_map_view;                       -- quiet window, see §8
REFRESH MATERIALIZED VIEW CONCURRENTLY sample_parent_key;
REFRESH MATERIALIZED VIEW CONCURRENTLY sample_summary;
REFRESH MATERIALIZED VIEW CONCURRENTLY source_type_statistics;
```

### Tier 2

```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY bgc_biome_summary_mv;                  -- 12 GB
REFRESH MATERIALIZED VIEW CONCURRENTLY bgc_data_source_counts;
REFRESH MATERIALIZED VIEW CONCURRENTLY bgc_gold_ecosystem_distribution_mv;
REFRESH MATERIALIZED VIEW CONCURRENTLY gcf_gold_ecosystem_distribution_mv;
REFRESH MATERIALIZED VIEW CONCURRENTLY study_ecosystem_dist;
REFRESH MATERIALIZED VIEW CONCURRENTLY sample_source_type_counts;
```

### Tier 3

```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY bgc_biome_level_1_distribution_mv;
REFRESH MATERIALIZED VIEW CONCURRENTLY bgc_biome_level_2_distribution_mv;
REFRESH MATERIALIZED VIEW CONCURRENTLY bgc_biome_level_3_distribution_mv;
REFRESH MATERIALIZED VIEW CONCURRENTLY bgc_biome_level_4_distribution_mv;
REFRESH MATERIALIZED VIEW CONCURRENTLY bgc_environment_distribution_mv;
REFRESH MATERIALIZED VIEW CONCURRENTLY bgc_feature_distribution_mv;
REFRESH MATERIALIZED VIEW CONCURRENTLY bgc_material_distribution_mv;
REFRESH MATERIALIZED VIEW CONCURRENTLY gcf_distributions_mv;
REFRESH MATERIALIZED VIEW CONCURRENTLY gcf_environmental_distribution_mv;
```

Tier 1 is about two thirds of the run. Size does not predict cost here; joins
do: `gcf_summary_mv` and `gcf_sample_map_mv` take longer than the 12 GB
`bgc_biome_summary_mv`. After a real ingest, expect the run to be slower than on
unchanged data.

Every matview has a unique index, so all of them refresh `CONCURRENTLY` and none
blocks reads while rebuilding. Running the SQL by hand rather than through §0
needs the statement timeout raised:

```bash
PGOPTIONS='-c statement_timeout=14400000' psql "$DATABASE_URL" -f refresh.sql
```

---

## 2. Offline-built tables

These are **tables**, not matviews, despite the `_mv` suffix on one of them: an
in-database rebuild is either impossible or far too expensive, so they are
computed elsewhere and loaded.

| object | rebuild |
|---|---|
| `gcf_taxonomy_distribution_mv` | `scripts/clustering-v3/backfill_taxonomy_dist.sql` (TRUNCATE + INSERT), then `ANALYZE` |
| `study_bgc_summary` (+ `study_gcf`, `gcf_study_count`) | `scripts/populator/tools/study_bgc_summary/build.py` then its `load.sql` — see that directory's README |

---

## 3. `assembly_taxonomy`

One resolved GTDB lineage per genome. A table, rebuilt by a nested-majority vote
over every genome BGC (minutes), so it can never be a request-path refresh.

```bash
# is it stale? exits 1 if so
DATABASE_URL=... python -m scripts.populator.tools.build_assembly_taxonomy --check

# rebuild (TRUNCATE + COPY in one transaction, runs its own gates)
DATABASE_URL=... python -m scripts.populator.tools.build_assembly_taxonomy --apply
```

Run `--check` after **every** load: any genome ingest or new BGCs on existing
genomes makes it stale, and a stale table means the Genome Collections charts
keep counting the old corpus while every other figure on the page has moved.

It must be rebuilt **after** §1 tier 1, because its own gates compare against
`source_type_statistics`.

---

## 4. Search indexes

The `/gcfs`, `/bgcs` and `/samples` list pages serve from OpenSearch; PostgreSQL
is only the fallback. Stale indexes therefore show stale rows even when every
matview above is current. Build as `bgc_indexer` (`scripts/opensearch/README.md`).

```bash
scripts/populator/tools/build_browse_corpus.py       # corpus for the browse indexes
scripts/populator/tools/browse_index_lifecycle.py    # versioned index + alias promote
scripts/populator/tools/extract_facets_shard.py      # property-search facets, per node
scripts/populator/tools/resolve_facets.py            #   ... joined with the database
scripts/populator/tools/os_bulk_load_parallel.py     # bulk load either corpus
scripts/populator/tools/build_facet_vocab.py         # facet vocabulary
```

- **Never rebuild an alias in place.** Build a versioned index and swap the
  alias, and diff per-field counts before swapping.
- A **corpus-based** rebuild drops any field that was patched in place on the
  live index. Check what has been patched before rebuilding from corpus.

A matview refresh does **not** reach a `gcf_browse` field on its own. These are
read from matviews or base tables, so after their source changes they stay on
the old values until the index is re-patched (`gcf_scalar_patch.py`) or rebuilt
from corpus. Neither shows as an error: they just return the old answer.

| field | source | serves |
|---|---|---|
| `dom_ecosystem_l3` | `gcf_distributions_mv` | advanced *Dominant ecosystem* |
| `biome_terms` | `gcf_environmental_distribution_mv` levels 1–3 | `/gcfs?biome=` and advanced *Biome* |
| `product_terms` | `unnest(bgcs.product)` over primary members | advanced *Product* |
| `taxonomy_terms` | `taxonomies` domain..species over primary members | advanced *Taxonomy* |

The last two are read from base tables, so they go stale on a BGC or taxonomy
load rather than a matview refresh. Their exact map queries are the `prt` and
`txt` joins in `build_browse_corpus.py`. Do **not** derive `taxonomy_terms`
from `gcf_taxonomy_distribution_mv`: it counts non-primary members and invents
`*__Unknown`, so it would disagree with the SQL fallback.

### Products and their categories

`gcf_product_type_matrix_mv` pairs each product with its category through
`product_category_map`, because `bgcs.product_category` is a sorted set and not
an array parallel to `bgcs.product`. **Re-check the map after an antiSMASH version
change or any BGC load that may bring new products**: a plain `REFRESH` gives an
unmapped product a NULL category without complaint.

```sql
-- products the map does not know (expect none)
SELECT DISTINCT p FROM bgcs, unnest(product) p
 WHERE NOT EXISTS (SELECT 1 FROM product_category_map m WHERE m.product = p);

-- BGCs whose categories the map does not reproduce (expect 0); one bgcs scan
SELECT count(*) FROM bgcs b
 WHERE (SELECT array_agg(DISTINCT m.product_category ORDER BY m.product_category)
          FROM unnest(b.product) p JOIN product_category_map m ON m.product = p)
       IS DISTINCT FROM
       (SELECT array_agg(DISTINCT c ORDER BY c) FROM unnest(b.product_category) c);
```

`product_type_distribution` on `gcf_browse` is copied from this view, so re-patch
it after the view changes (`gcf_scalar_patch.py … --json product_type_distribution`).

To re-patch `biome_terms` (builds a new index next to the live one):

```bash
psql "$DSN" -At -F$'\t' -c "SELECT 'gcf_id','biome_terms'" -c "
  SELECT s.gcf_id, COALESCE(array_to_string(b.terms, chr(31)), '')
  FROM gcf_summary_mv s LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT v ORDER BY v) AS terms
    FROM gcf_environmental_distribution_mv e,
         LATERAL (VALUES (e.biome_level_1), (e.biome_level_2), (e.biome_level_3)) t(v)
    WHERE e.gcf_id = s.gcf_id AND v IS NOT NULL) b ON true" > biome_terms.tsv
gcf_scalar_patch.py biome_terms.tsv "$OS" <live index> <new index> --list biome_terms
```

`--list` matters: without it every family gets one string containing `\x1f`
separators, which matches nothing an `equals` asks for. Check that
`max_result_window` came across before the swap; the tool refuses if it did not.

---

## 5. Snapshots

Static JSON the pages read instead of hitting the API. None of them regenerate
themselves; all go stale silently.

```
bgc-atlas/scripts/generate-map-snapshot.ts            # homepage map
bgc-atlas/scripts/generate-sample-charts-snapshot.ts  # samples + genome-collections charts
bgc-atlas/scripts/generate-bgc-charts-snapshot.ts
bgc-atlas/scripts/generate-gcf-charts-snapshot.ts
```

Regenerate after any change to sample geography, GOLD paths or the distributions
behind those charts.

---

## 6. Caches

Run `refresh-views-cron.sh` (§0) **last**, even if the matviews were refreshed
by hand: its tail end busts the Redis stats caches and re-warms the common
variants, so new numbers appear immediately instead of waiting out a 6–24h TTL.

---

## 7. Re-deriving §1

After adding or dropping a matview, regenerate the order rather than editing it.

```sql
-- the graph
SELECT dep.relname AS matview, ref.relname AS depends_on
FROM pg_depend d
JOIN pg_rewrite r ON r.oid = d.objid
JOIN pg_class dep ON dep.oid = r.ev_class
JOIN pg_class ref ON ref.oid = d.refobjid
WHERE d.classid = 'pg_rewrite'::regclass AND d.refclassid = 'pg_class'::regclass
  AND dep.relkind = 'm' AND ref.relkind = 'm' AND dep.oid <> ref.oid
ORDER BY 1, 2;

-- which can take CONCURRENTLY
SELECT c.relname,
       EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indisunique) AS concurrent_ok,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS size
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'm' AND n.nspname = 'public'
ORDER BY pg_total_relation_size(c.oid) DESC;
```

Tier N = 1 + the maximum tier of its matview inputs.

---

## 8. Traps

- **The app DSN caps every statement at 120s.** `DATABASE_URL` carries a
  `statement_timeout` to kill abandoned request-path queries, and it applies to
  anything using that connection string — including a `psql` session started
  from it. Several refreshes take far longer, so they die at exactly 120s with
  no partial progress. The script in §0 sets `statement_timeout = 0` on its own
  session; by hand, prefix with `PGOPTIONS='-c statement_timeout=14400000'`.
- **`work_mem` is per node, per worker.** It is multiplied by
  `hash_mem_multiplier` and by every parallel worker, so a generous setting can
  exhaust memory. Use 64 MB at most, with `max_parallel_workers_per_gather = 0`.
- **Never wrap several matview refreshes in one transaction.** One statement,
  one commit.
- **`CONCURRENTLY` needs a unique index with no WHERE clause.** Without one it
  errors before doing any work; give every new matview one.
- **A cancelled `CONCURRENTLY` can leave a stuck backend.** Check
  `pg_stat_activity` and `pg_terminate_backend` the stale one before retrying.
- **`sample_map_view` under IO pressure blocks map reads.** Run it in a quiet
  window.
- **Check `pg_stat_activity` before blaming a slow refresh.** An abandoned
  application query can starve everything else.
- **Ordering matters even though these are full rebuilds.** A dependent refreshed
  before its input is not wrong-looking, just one generation stale — which is
  exactly why it survives unnoticed.

---

## 9. Verification

```sql
-- nothing left unpopulated
SELECT relname FROM pg_class WHERE relkind = 'm' AND NOT relispopulated;

-- the genome charts agree with the stat strip
SELECT (SELECT COALESCE(SUM(assembly_count),0)
          FROM source_type_statistics
         WHERE source_type IN ('isolate','MAG','SAG')) AS stat_strip_genomes,
       (SELECT count(*) FROM assemblies a
         WHERE a.source_type IN ('isolate','MAG','SAG')) AS actual;
-- the two must be equal
```

```bash
# assembly_taxonomy in step with the corpus
... build_assembly_taxonomy --check     # expect "no drift detected", exit 0
```

Then load `/genome-collections` and `/samples` and confirm the stat strips, the
sunburst centres and the table totals agree. A number that disagrees with the
strip beside it is the failure mode every item above exists to prevent.

Open the **last page** of `/bgcs`, `/gcfs`, `/genome-collections` and `/samples`
and check its row count against the remainder. An HTTP 200 is not enough: the
pager computes "Showing X–Y of Z" from offset and page size before a single row
arrives.

Deep paging on `/bgcs` needs no post-load step: it resolves a rank by counting
against the browse index at request time.

`/gcfs` and `/samples` page with `from + size`, bounded by each index's
`max_result_window`, so a load that pushes a corpus past its window silently
cuts off the last pages:

```bash
# headroom per index; re-size in browse_index_mapping.py if it is thin
source scripts/opensearch/oscurl.sh   # credentials + CA, see scripts/opensearch/README.md
for a in gcf_browse sample_browse; do
  docs=$(oscurl "$OPENSEARCH_URL/$a/_count" | python3 -c 'import sys,json;print(json.load(sys.stdin)["count"])')
  win=$(oscurl "$OPENSEARCH_URL/$a/_settings?filter_path=**.max_result_window" \
        | python3 -c 'import sys,json;d=json.load(sys.stdin);print(list(d.values())[0]["settings"]["index"]["max_result_window"])')
  echo "$a docs=$docs window=$win"
done
```

The windows are sized to roughly double each corpus, to leave room for growth.
