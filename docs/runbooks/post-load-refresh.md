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
REFRESH MATERIALIZED VIEW CONCURRENTLY assembly_bgc_counts_mv;                -- the Assemblies view's # BGCs
REFRESH MATERIALIZED VIEW CONCURRENTLY bgc_product_category_distribution_mv;
REFRESH MATERIALIZED VIEW CONCURRENTLY bgc_gold_bucket_counts;
REFRESH MATERIALIZED VIEW CONCURRENTLY bgc_product_facet_counts;
REFRESH MATERIALIZED VIEW CONCURRENTLY data_source_statistics;
REFRESH MATERIALIZED VIEW CONCURRENTLY gcf_assembly_source_stats_mv;
REFRESH MATERIALIZED VIEW CONCURRENTLY gcf_length_stats_mv;
REFRESH MATERIALIZED VIEW CONCURRENTLY gcf_product_category_distribution_mv;
REFRESH MATERIALIZED VIEW CONCURRENTLY gcf_category_combination_mv;           -- one bgcs scan
REFRESH MATERIALIZED VIEW CONCURRENTLY gcf_product_type_matrix_mv;
REFRESH MATERIALIZED VIEW CONCURRENTLY gcf_product_type_member_mv;            -- one bgcs scan
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
REFRESH MATERIALIZED VIEW CONCURRENTLY gcf_member_ecosystem_mv;               -- one bgcs scan; reads assembly_samples_mv
REFRESH MATERIALIZED VIEW CONCURRENTLY study_ecosystem_dist;
REFRESH MATERIALIZED VIEW CONCURRENTLY study_geo_mv;                          -- reads sample_summary + sample_parent_key
REFRESH MATERIALIZED VIEW CONCURRENTLY study_map_points_mv;
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
REFRESH MATERIALIZED VIEW CONCURRENTLY gcf_distributions_mv;                  -- reads both member views above
REFRESH MATERIALIZED VIEW CONCURRENTLY gcf_environmental_distribution_mv;
```

Tier 1 is about two thirds of the run. Size does not predict cost here; joins
do: `gcf_summary_mv` and `gcf_sample_map_mv` take longer than the 12 GB
`bgc_biome_summary_mv`. After a real ingest, expect the run to be slower than on
unchanged data.

`gcf_distributions_mv` builds its ecosystem distributions, `max_pct_l*`,
`dom_ecosystem_l*`, `resolved_pct_l*`, the `eco_l*_ge*` arrays and the
product-type shares from `gcf_product_type_member_mv` (tier 1: `bgcs` +
`bgc_gcf`) and `gcf_member_ecosystem_mv` (tier 2: each member's ecosystem is that
of its assembly's first-ranked sample, so it reads `assembly_samples_mv`).
Refresh either one late, or not at all, and `/gcfs` reports the previous shares
with nothing to show it.

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

The share columns of `gcf_distributions_mv` -- `product_type_member_share`,
`product_types_ge*`, `eco_l<n>_ge*`, `resolved_pct_l*`, `dom_ecosystem_l*` and
`max_pct_l*` -- go stale the same way: after refreshing `gcf_distributions_mv`,
re-patch them as in "Share fields" below. A corpus rebuild selects them
(`build_browse_corpus.py`), so it does not drop them.

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

### Share fields

The `/gcfs` product and ecosystem share filters read these `gcf_browse` fields,
all from `gcf_distributions_mv`:

| field | type | holds |
|---|---|---|
| `product_type_member_share` | object, not indexed | {antiSMASH product: % of primary members carrying it}; display only |
| `product_types_ge10/50/90` | keyword list | products carried by at least 10/50/90% of members |
| `eco_l<n>_ge10/50/90` | keyword list | level-n ecosystems with at least that share |
| `eco_l<n>_any` | keyword list | every level-n ecosystem at least one member has |
| `resolved_pct_l<n>` | float | % of members with a level-n ecosystem |
| `dom_ecosystem_l*`, `max_pct_l*`, `biome_distribution_l*` | | the dominant ecosystem and the distributions |

`build_browse_corpus.py` selects all of them, so a corpus rebuild needs nothing
below. Patch an existing index after refreshing `gcf_distributions_mv`, or to
add the fields to an index built without them. There are two maps:
`gcf_share_fields_map.sql` (40 columns) and `gcf_share_fields_any_map.sql` (the
five `eco_l<n>_any` lists). Patch the second onto the index the first produced,
then verify and swap once.

**Before you start.**
- No other writer to `gcf_browse`: no other patch, corpus load or alias change.
  A family written to the source after the scroll passes it is lost at the swap.
- `gcf_scalar_patch.py` holds the whole map in memory, about 6 KB per listed
  family for the 40-column map (~3.5 GB for 630k families); check `free -g`.
- Run under `nice` and not alongside `next build`: the host also serves the site.
- Run the block in `bash`, as `bgc_indexer` (`OPENSEARCH_URL`, `OPENSEARCH_USERNAME`,
  `OPENSEARCH_PASSWORD`, `OPENSEARCH_CA_CERT` set; `scripts/opensearch/README.md`).
  A failed gate runs `exit 1` and ends that shell, which is the point.

```bash
bash
source scripts/opensearch/oscurl.sh
OS=$OPENSEARCH_URL; DSN='<database URL>'; OUT='<scratch dir on shared storage>'
T=scripts/populator/tools
SRC=$(oscurl "$OS/_cat/aliases/gcf_browse?h=index" | tr -d '[:space:]')
MID=gcf_browse_v$(date +%Y%m%d)share
DST=gcf_browse_v$(date +%Y%m%d)shareany
[ -n "$SRC" ] || { echo "no index behind gcf_browse: stop"; exit 1; }
for i in "$MID" "$DST"; do
  [ "$(oscurl -o /dev/null -w '%{http_code}' "$OS/$i")" = 404 ] || { echo "$i exists: stop"; exit 1; }
done
set -o pipefail

# 1. export both maps (read-only; seq-scans gcfs and gcf_distributions_mv, no bgcs)
psql "$DSN" -X -At -F$'\t' -v ON_ERROR_STOP=1 -f $T/gcf_share_fields_map.sql > "$OUT/share.tsv"
psql "$DSN" -X -At -F$'\t' -v ON_ERROR_STOP=1 -f $T/gcf_share_fields_any_map.sql > "$OUT/share_any.tsv"
awk -F'\t' 'NF != 40' "$OUT/share.tsv" | wc -l          # 0
awk -F'\t' 'NF != 6' "$OUT/share_any.tsv" | wc -l       # 0
tail -n +2 "$OUT/share.tsv" | wc -l                      # = listed families; same for share_any.tsv

# 2. flags
FLAGS="--json product_type_member_share --type product_type_member_share:object-disabled"
for t in 10 50 90; do FLAGS="$FLAGS --list product_types_ge$t --type product_types_ge$t:keyword"; done
for n in 1 2 3 4 5; do
  for t in 10 50 90; do FLAGS="$FLAGS --list eco_l${n}_ge$t --type eco_l${n}_ge$t:keyword"; done
  FLAGS="$FLAGS --type resolved_pct_l$n:float --json biome_distribution_l$n"
done
for n in 2 4 5; do FLAGS="$FLAGS --type dom_ecosystem_l$n:keyword"; done
ANY=""
for n in 1 2 3 4 5; do ANY="$ANY --list eco_l${n}_any --type eco_l${n}_any:keyword"; done

# 3. dry run (creates nothing): check the properties it would add and overwrite,
#    and that max_result_window is carried
python3 $T/gcf_scalar_patch.py "$OUT/share.tsv" "$OS" "$SRC" "$MID" $FLAGS --dry-run

# 4. patch twice; each writes only its destination, and the alias is untouched
nice -n 10 python3 $T/gcf_scalar_patch.py "$OUT/share.tsv" "$OS" "$SRC" "$MID" $FLAGS \
  2>&1 | tee "$OUT/share_patch.log" || { echo "patch failed: do not swap"; exit 1; }
nice -n 10 python3 $T/gcf_scalar_patch.py "$OUT/share_any.tsv" "$OS" "$MID" "$DST" $ANY \
  2>&1 | tee "$OUT/share_any_patch.log" || { echo "patch failed: do not swap"; exit 1; }
```

Each patch must end with "counts match, every family mapped". The "documents
changed" total counts every family that gained a field; for the re-sent columns
(`max_pct_l*`, `dom_ecosystem_l*`, `biome_distribution_l*`), read the per-field
"changed on" column instead. A large number there means the index was older than
the view. The tool refuses an existing destination; `--resume` is only for
continuing a run you started.

**Verify before the swap.** The index and the SQL fallback must give the same
counts. Pick a product and a level-3 ecosystem that occur in the data:

```bash
P=RiPP-like; E=Marine
q() { oscurl "$OS/$DST/_count" -H 'Content-Type: application/json' -d "{\"query\":$1}" | grep -o '"count":[0-9]*'; }
oscurl "$OS/$DST/_count"                                     # = listed families
oscurl "$OS/$DST/_settings" | grep -o '"max_result_window":"[0-9]*"'
q "{\"term\":{\"product_types_ge50\":\"$P\"}}"
q "{\"term\":{\"eco_l3_ge50\":\"$E\"}}"
q "{\"term\":{\"eco_l3_any\":\"$E\"}}"
q '{"exists":{"field":"resolved_pct_l1"}}'
q '{"exists":{"field":"eco_l3_any"}}'
```

```sql
-- the same numbers from the database (read-only, seconds)
\set p 'RiPP-like'
\set e 'Marine'
SET statement_timeout = '60s';
SELECT count(*)                                                        AS listed,
       count(*) FILTER (WHERE :'p' = ANY(d.product_types_ge50))        AS product_ge50,
       count(*) FILTER (WHERE :'e' = ANY(d.eco_l3_ge50))               AS eco_l3_ge50,
       count(*) FILTER (WHERE d.biome_distribution_l3 ? :'e')          AS eco_l3_any,
       count(*) FILTER (WHERE d.resolved_pct_l1 IS NOT NULL)           AS resolved_l1,
       count(*) FILTER (WHERE d.biome_distribution_l3 <> '{}')         AS any_l3
FROM gcfs g LEFT JOIN gcf_distributions_mv d ON d.gcf_id = g.id WHERE g.listed;
```

Also check one family's document against its `gcf_distributions_mv` row
(`_search` with a `term` on `gcf_id`, `_source` limited to the share fields).

**Swap**, one atomic call. The second patch prints a swap command with `$MID` as
the source; `$MID` is not behind the alias, so use this one:

```bash
oscurl -XPOST "$OS/_aliases" -H 'Content-Type: application/json' \
  -d "{\"actions\":[{\"remove\":{\"index\":\"$SRC\",\"alias\":\"gcf_browse\"}},{\"add\":{\"index\":\"$DST\",\"alias\":\"gcf_browse\"}}]}"
oscurl "$OS/_cat/aliases/gcf_browse?v"                       # -> $DST
```

Cached `/api/gcfs` pages keep their old rows until their TTL expires. The
`eco_l<n>_any` lists are picked up within a minute without a restart: until the
alias points at an index that has all five, the app sends "any member" ecosystem
conditions to the SQL fallback (`lib/opensearch/gcf-browse-fields.ts`, checked
every 60 s).

**Rollback**: the same call with `$SRC` and `$DST` exchanged. If `$SRC` lacks
the share fields, every share filter on `/gcfs` then shows no families instead
of an error: a `term` query on a missing field matches nothing. So roll back only
to an index that has them, or roll the app back with it.

**Cleanup**, once `$DST` has served without a rollback: delete `$MID` and `$SRC`
(list the indexes first, then `oscurl -XDELETE "$OS/<literal name>"`), and the TSVs
and logs in `$OUT`.

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
