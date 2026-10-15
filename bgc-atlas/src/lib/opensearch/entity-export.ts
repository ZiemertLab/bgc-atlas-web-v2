// "Download all" for the Property Search Return switcher. Rows are aggregation buckets,
// which cannot be scrolled, so the export takes the pager's single aggregation in full,
// bounded by ENTITY_CAP: no row the pager cannot reach.
import { buildQuery, hydrateEntities, osFetch } from '@/lib/opensearch/client';
import { familyScopeSurvivors } from '@/lib/opensearch/family-scope';
import { ENTITY_CAP } from '@/lib/opensearch/entity-paging';
import {
  entityExportColumns, toEntityExportRow, type EntityExportInput,
} from '@/lib/opensearch/entity-export-columns';
import { serializeDelimited, serializeJsonRows } from '@/lib/opensearch/export-columns';
import { hasFilterRules, type FilterGroup } from '@/lib/filters/types';

const INDEX = process.env.OPENSEARCH_INDEX || 'bgc_facets';
const GCF_BROWSE_INDEX = process.env.OPENSEARCH_GCF_BROWSE_INDEX || 'gcf_browse';
const SAMPLE_BROWSE_INDEX = process.env.OPENSEARCH_SAMPLE_BROWSE_INDEX || 'sample_browse';

/** Ids per hydration round trip: hydrateEntities asks for `size: ids.length`, which must
 *  fit the default 10,000 result window. */
const HYDRATE_BATCH = 5_000;

/** Unlisted families resolved from Postgres per round trip. */
const PG_FALLBACK_BATCH = 2_000;

export interface EntityExportParams {
  group: FilterGroup | null;
  entity: 'gcfs' | 'samples';
  /** Present when the query is family-scoped; rows then carry cohort counts. */
  familyScope?: { cohorts: FilterGroup[]; minPurity?: number; labels?: string[] } | null;
  format: 'csv' | 'tsv' | 'json';
}

export interface EntityExportResult {
  content: string;
  /** Rows written — the filename states it, as the BGC export does. */
  count: number;
  /** ENTITY_CAP was reached: the file is the top `count` by matching BGCs. */
  capped: boolean;
}

/** Every bucket the filter groups to, ordered by matching BGCs, up to ENTITY_CAP. */
async function collectBuckets(
  group: FilterGroup | null, entity: 'gcfs' | 'samples',
): Promise<{ id: string; bgcCount: number }[]> {
  const field = entity === 'gcfs' ? 'gcf_id' : 'sample_id';
  const r = await osFetch(INDEX, {
    size: 0,
    query: await buildQuery(group),
    aggs: { all: { terms: { field, size: ENTITY_CAP, order: { _count: 'desc' } } } },
  }) as { aggregations?: { all?: { buckets?: { key: unknown; doc_count: number }[] } } };
  return (r.aggregations?.all?.buckets ?? [])
    .map((b) => ({ id: String(b.key), bgcCount: b.doc_count }));
}

/** Hydrate ids from the browse index in windows the result window allows. */
async function hydrateAll(
  index: string, ids: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const byId = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < ids.length; i += HYDRATE_BATCH) {
    const batch = await hydrateEntities(index, ids.slice(i, i + HYDRATE_BATCH));
    for (const [id, doc] of batch) byId.set(id, doc);
  }

  // hydrateEntities caps its Postgres fallback at 200 per call; an export sweeps the
  // rest with the cap lifted.
  if (index === GCF_BROWSE_INDEX) {
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length) {
      try {
        const { fetchGcfDocumentsFromPostgres } = await import('@/lib/gcf/postgres-documents');
        for (let i = 0; i < missing.length; i += PG_FALLBACK_BATCH) {
          const slice = missing.slice(i, i + PG_FALLBACK_BATCH);
          for (const document of await fetchGcfDocumentsFromPostgres(slice, slice.length)) {
            const id = document.gcf_id;
            if (typeof id === 'string') byId.set(id, document);
          }
        }
      } catch (error) {
        // Enrichment: a row with an id and a matching count is still worth shipping.
        console.error('Postgres fallback for unindexed GCF export rows failed:', error);
      }
    }
  }
  return byId;
}

export async function exportEntities(params: EntityExportParams): Promise<EntityExportResult> {
  const { entity, group, format } = params;
  const scope = params.familyScope;
  // Match `familyScopeSurvivors`, which drops cohorts with no rules: the survivors'
  // `cohortCounts` are indexed against the filtered list.
  const activeCohorts = (scope?.cohorts ?? []).filter((c) => hasFilterRules(c));
  const cohortLabelFor = (i: number) =>
    (scope?.labels?.[i] ?? '').trim() || `Cohort ${String.fromCharCode(65 + i)}`;
  const scoped = entity === 'gcfs' && activeCohorts.length > 0;

  let inputs: EntityExportInput[];
  let capped: boolean;

  if (scoped) {
    // One run of the two passes; `searchFamilyScope` would re-run both per hundred rows.
    const { survivors } = await familyScopeSurvivors({
      group, cohorts: activeCohorts, minPurity: scope!.minPurity,
    });
    const kept = survivors.slice(0, ENTITY_CAP);
    const byId = await hydrateAll(GCF_BROWSE_INDEX, kept.map((s) => s.id));
    inputs = kept.map((s) => ({
      id: s.id,
      // Ordered by members inside the cohorts, the number the "Matching BGCs" column shows.
      bgcCount: s.inside,
      source: byId.get(s.id) ?? {},
      cohortCounts: s.cohortCounts,
      inside: s.inside,
      located: s.located,
      members: s.members,
      purity: s.purity,
    }));
    capped = survivors.length > ENTITY_CAP;
  } else {
    const buckets = await collectBuckets(group, entity);
    const index = entity === 'gcfs' ? GCF_BROWSE_INDEX : SAMPLE_BROWSE_INDEX;
    const byId = await hydrateAll(index, buckets.map((b) => b.id));
    inputs = buckets.map((b) => ({
      id: b.id, bgcCount: b.bgcCount, source: byId.get(b.id) ?? {},
    }));
    capped = buckets.length >= ENTITY_CAP;
  }

  const cohortLabels = scoped ? activeCohorts.map((_, i) => cohortLabelFor(i)) : [];
  const columns = entityExportColumns(entity, cohortLabels);
  const rows = inputs.map((input) => toEntityExportRow(entity, input));

  const content = format === 'json'
    ? JSON.stringify(serializeJsonRows(rows, columns), null, 2)
    : serializeDelimited(rows, columns, format === 'csv' ? ',' : '\t');

  return { content, count: rows.length, capped };
}
