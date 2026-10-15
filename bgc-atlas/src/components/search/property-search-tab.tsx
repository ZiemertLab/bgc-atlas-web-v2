'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Search, Filter, ChevronDown, Clock, Download } from 'lucide-react';
import { apiFetch, withBase } from '@/lib/basePath';
import { PROPERTY_GBK_EXPORT_MAX_REGIONS } from '@/lib/gcf/export-limits';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { toDelimited, toJsonRows } from '@/lib/opensearch/export-columns';
import { storeJob } from '@/lib/utils/job-cookies';
import { Pagination } from '@/components/ui/pagination';
import { ResizableTable } from '@/components/ui/resizable-table';
import {
  HIDDEN_WITH_REFINE, columnForSortField, propertyResultColumns, sortFieldFor, type Hit, type TaxRank,
} from '@/components/search/property-results-columns';
import { QueryRows, QuerySummary, rowsSummary, useDescribeCondition, type SummaryRow } from '@/components/search/property-query-rows';
import { SavedSearchesMenu } from '@/components/search/saved-searches-menu';
import { CopyLinkButton } from '@/components/ui/copy-link-button';
import { DistributionPanel } from '@/components/search/distribution-panel';
import { GeoPanel } from '@/components/search/geo-panel';
import { EntityResults } from '@/components/search/entity-results';
import {
  deserializeFamilyScope, serializeFamilyScope, type FamilyScope,
} from '@/lib/filters/family-scope-url';
import { MAX_COHORTS } from '@/lib/opensearch/entity-paging';
import {
  conditionRow, groupToRows, rowsExpression, rowsHaveRules, rowsToGroup, type FilterRow,
} from '@/lib/filters/rows';
import {
  bgcPropertyFilterFields, booleanFacetFields, booleanFacetLabel, defaultFacetFields,
  facetValueCondition,
} from '@/lib/filters/bgc-property-fields';
import { getProductCategoryColor } from '@/lib/utils/chart-utils';
import { getEcosystemChartColorHex } from '@/lib/utils/gold-parser';
import { cn } from '@/lib/utils';
import {
  createDefaultFilterGroup, createFilterCondition, deserializeFilterGroup,
  hasFilterRules, serializeFilterGroup, type FilterCondition, type FilterGroup,
} from '@/lib/filters/types';

interface FacetBucket { value: string; count: number; label?: string; }
interface SearchResult {
  total: number;
  hits: Record<string, unknown>[];
  facets: Record<string, FacetBucket[]>;
}
type Sort = { field: string; order: 'asc' | 'desc' } | null;

const fieldLabel = new Map(bgcPropertyFilterFields.map((f) => [f.id, f.label]));

const stripRank = (s: string) => s.replace(/^[a-z]__/, '');

// Boolean facets aggregate to "1"/"0"; render them as human labels in the refine panel.
const facetDisplay = (field: string, value: string): string =>
  booleanFacetFields.has(field) ? booleanFacetLabel(field, value) : stripRank(value);
const facetSwatch = (field: string, value: string): string | null => {
  if (field === 'product_category') return getProductCategoryColor(value);
  if (field === 'gold_ecosystem') return getEcosystemChartColorHex(value);
  // A yes/no property is not an outcome: ink for yes, grey for no, never status colours.
  if (booleanFacetFields.has(field)) return value === '1' || value === 'true' ? 'var(--foreground)' : 'var(--muted-foreground)';
  return null;
};
const cond = (field: string, op: string, value: unknown) => createFilterCondition(field, op as never, value as never);

const mkGroup = (operator: 'AND' | 'OR', conditions: FilterCondition[], groups: FilterGroup[] = []): FilterGroup =>
  ({ ...createDefaultFilterGroup(), operator, conditions, groups });

type Entity = 'bgcs' | 'gcfs' | 'samples';

// Families with two or more member sets are a family-scope question (each set matched by at
// least one member); otherwise the first set is a plain filter.
function queryOf(entity: Entity, sets: FilterRow[][], labels: string[], minPurity: number,
  describe: (c: FilterCondition) => string): { group: FilterGroup | null; scope: FamilyScope | null } {
  const live = sets.filter(rowsHaveRules);
  if (entity === 'gcfs' && live.length >= 2) {
    const kept = sets.map((rows, i) => ({ rows, label: labels[i] ?? '' })).filter((x) => rowsHaveRules(x.rows));
    return {
      group: null,
      scope: {
        cohorts: kept.map((x) => rowsToGroup(x.rows)),
        labels: kept.map((x) => x.label.trim() || rowsExpression(x.rows, describe).map((p) => p.value).join(' ')),
        minPurity,
      },
    };
  }
  return { group: rowsHaveRules(sets[0] ?? []) ? rowsToGroup(sets[0]) : null, scope: null };
}

/** An old ?fam link: its base filter applied to every member, so it goes into each set. */
const setsFromScope = (base: FilterGroup | null, scope: FamilyScope): FilterRow[][] =>
  scope.cohorts.map((cohort) => groupToRows(base && hasFilterRules(base)
    ? { ...createDefaultFilterGroup(), groups: [base, cohort] }
    : cohort));

// Rebuilt on click so ids are unique. `entity` and `scope` are carried so an example restores
// the whole question, not just its rows.
const EXAMPLES: {
  name: string;
  hint: string;
  build: () => FilterGroup;
  entity?: 'bgcs' | 'gcfs' | 'samples';
  scope?: () => FamilyScope;
}[] = [
  {
    name: 'Metagenomic lassopeptides',
    hint: 'Product = lassopeptide, from metagenome samples',
    build: () => mkGroup('AND', [
      cond('product', 'in', ['lassopeptide']),
      cond('sample_type', 'in', ['metagenome']),
    ]),
  },
  {
    name: 'Glycopeptide-like BGCs',
    hint: 'antiSMASH domain = X',
    build: () => mkGroup('AND', [
      cond('antismash_domains', 'in', ['X']),
    ]),
  },
  {
    name: 'Polar complete hybrid RiPPs',
    hint: 'RiPP, complete, chemical-hybrid, from Arctic or Antarctic (|lat| > 66.5°)',
    build: () => mkGroup('AND', [
      cond('product_category', 'in', ['RiPP']),
      cond('is_complete', 'equals', 'true'),
      cond('candidate_kind', 'in', ['chemical_hybrid']),
    ], [
      mkGroup('OR', [
        cond('latitude', 'gt', '66.5'),
        cond('latitude', 'lt', '-66.5'),
      ]),
    ]),
  },
  {
    name: 'Bipolar families',
    hint: 'Families with members in the Arctic AND the Antarctic, and nowhere else',
    build: () => createDefaultFilterGroup(),
    entity: 'gcfs',
    scope: () => ({
      cohorts: [
        mkGroup('AND', [cond('latitude', 'gt', '66.5')]),
        mkGroup('AND', [cond('latitude', 'lt', '-66.5')]),
      ],
      labels: ['Arctic', 'Antarctic'],
      minPurity: 1,
    }),
  },
  {
    name: 'Photorhabdus NRPS',
    hint: 'Genus = Photorhabdus (entomopathogen), NRPS category',
    build: () => mkGroup('AND', [
      cond('tax_genus', 'in', ['g__Photorhabdus']),
      cond('product_category', 'in', ['NRPS']),
    ]),
  },
];

export function PropertySearchTab() {
  // One list of rows per member set; only Families use more than the first.
  const [sets, setSets] = useState<FilterRow[][]>([[]]);
  // Names from an old ?fam link; empty for sets built here.
  const [setLabels, setSetLabels] = useState<string[]>([]);
  // 1 = only families whose members all match; an old link can carry values in between.
  const [minPurity, setMinPurity] = useState(1);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState<Sort>({ field: 'length', order: 'desc' });
  const [taxRank, setTaxRank] = useState<TaxRank>('auto');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showRefine, setShowRefine] = useState(false);
  const [facets, setFacets] = useState<Record<string, FacetBucket[]>>({});
  const [facetsLoading, setFacetsLoading] = useState(false);
  const [showTable, setShowTable] = useState(true);
  const [gbkStarting, setGbkStarting] = useState(false);
  const [gbkError, setGbkError] = useState<string | null>(null);
  const [gbkDialogOpen, setGbkDialogOpen] = useState(false);
  const [gbkEmail, setGbkEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  // The last-submitted query, so the charts follow the shown results rather than unsubmitted edits.
  const [searchedGroup, setSearchedGroup] = useState<FilterGroup | null>(null);
  const [searchNonce, setSearchNonce] = useState(0);
  // 'bgcs' pages documents; the others group the matching BGC set.
  const [returnEntity, setReturnEntity] = useState<Entity>('bgcs');
  const [searchedScope, setSearchedScope] = useState<FamilyScope | null>(null);

  const describe = useDescribeCondition(bgcPropertyFilterFields);
  const setRows = (index: number, rows: FilterRow[]) =>
    setSets((prev) => prev.map((r, i) => (i === index ? rows : r)));

  // Set from the handler, not an effect: an effect would fire on mount and strip ?ret before restore ran.
  const changeReturnEntity = (next: Entity) => {
    setReturnEntity(next);
    if (next !== 'gcfs') setSets((prev) => prev.slice(0, 1));
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (next === 'bgcs') params.delete('ret');
    else params.set('ret', next);
    if (next !== 'gcfs') params.delete('fam');
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
  };

  /** ?props / ?ret / ?fam for a query, written on search and by Copy link. */
  const queryParams = (entity: Entity, q: { group: FilterGroup | null; scope: FamilyScope | null }) => {
    const params = new URLSearchParams(window.location.search);
    params.set('tab', 'properties');
    const serialized = serializeFilterGroup(q.group);
    if (serialized) params.set('props', serialized); else params.delete('props');
    if (entity === 'bgcs') params.delete('ret'); else params.set('ret', entity);
    const serializedScope = serializeFamilyScope(q.scope);
    if (serializedScope) params.set('fam', serializedScope); else params.delete('fam');
    params.delete('advancedFilters');
    return params;
  };

  // Built from on-screen state: ?props and ?fam are only written on search, so the address bar lags.
  const shareHref = () => {
    const params = queryParams(returnEntity, queryOf(returnEntity, sets, setLabels, minPurity, describe));
    return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
  };

  const runSearch = async (
    nextPage: number,
    opts: {
      sets?: FilterRow[][]; sort?: Sort; size?: number;
      // React state set in the same click is not readable yet, so an example passes these in.
      entity?: Entity; labels?: string[]; minPurity?: number;
    } = {},
  ) => {
    const entity = opts.entity ?? returnEntity;
    const q = queryOf(entity, opts.sets ?? sets, opts.labels ?? setLabels, opts.minPurity ?? minPurity, describe);
    const s = opts.sort !== undefined ? opts.sort : sort;
    const size = opts.size ?? pageSize;

    setLoading(true);
    setError(null);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `${window.location.pathname}?${queryParams(entity, q).toString()}`);
    }
    try {
      const res = await apiFetch('/api/search/properties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group: q.group,
          page: nextPage, size, sort: s ?? undefined,
          // Facet counts are fetched separately, when Refine opens.
          facetFields: [],
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Search failed'); setResult(null); }
      else {
        setResult(data);
        setPage(nextPage);
        setSearchedGroup(q.group);
        setSearchedScope(q.scope);
        setSearchNonce((n) => n + 1);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
      setResult(null);
    } finally { setLoading(false); }
  };

  // Asks the catalog for the field's operator: `in` on a boolean field is a 400.
  const addFacet = (field: string, value: string) => {
    const next = sets.map((rows, i) => (i === 0 ? [...rows, conditionRow(facetValueCondition(field, value), 'AND')] : rows));
    setSets(next);
    runSearch(1, { sets: next });
  };

  // Unlike Refine, a chart drill-down does not re-run; the reader presses Search.
  const addCondition = (c: FilterCondition) => {
    setSets((prev) => prev.map((rows, i) => (i === 0 ? [...rows, conditionRow(c, 'AND')] : rows)));
  };

  const loadExample = (ex: (typeof EXAMPLES)[number]) => {
    const entity = ex.entity ?? 'bgcs';
    const scope = ex.scope?.();
    const next = scope ? setsFromScope(ex.build(), scope) : [groupToRows(ex.build())];
    setSets(next);
    setSetLabels([]);
    setMinPurity(scope?.minPurity ?? 1);
    changeReturnEntity(entity);
    runSearch(1, { sets: next, entity, labels: [], minPurity: scope?.minPurity ?? 1 });
  };

  const clearAll = () => {
    setSets([[]]);
    setSetLabels([]);
    setMinPurity(1);
  };

  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const triggerDownload = (content: BlobPart, mime: string, filename: string) => {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
  };

  const downloadPage = (format: 'csv' | 'tsv' | 'json') => {
    if (!result) return;
    const content = format === 'json'
      ? JSON.stringify(toJsonRows(result.hits), null, 2)
      : toDelimited(result.hits, format === 'csv' ? ',' : '\t');
    const mime = format === 'json' ? 'application/json'
      : format === 'csv' ? 'text/csv' : 'text/tab-separated-values';
    triggerDownload(content, mime, `bgc_page_${page}_${stamp()}.${format}`);
  };

  const downloadAll = async (format: 'csv' | 'tsv' | 'json') => {
    setExporting(true);
    setError(null);
    try {
      const effective = queryOf(returnEntity, sets, setLabels, minPurity, describe).group;
      const res = await apiFetch('/api/search/properties/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group: effective,
          sort: sort ?? undefined,
          format,
        }),
      });
      if (!res.ok) {
        // Surface the 400's message: it names the field and operator, and this path is the
        // only place that repair text appears.
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Export failed');
      }
      const capped = res.headers.get('X-Capped') === '1';
      const blob = await res.blob();
      triggerDownload(blob, blob.type, `bgc_properties_all_${stamp()}.${format}`);
      if (capped) setError('Export was capped at 100,000 rows — narrow the query for a complete export.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  // Opens its own /exports/<id> page in a new tab: an export can run for hours.
  const startGbkExport = (email?: string) => {
    if (gbkStarting) return;
    setGbkError(null);
    // Opened before any await: after one it is no longer a user gesture and popup blockers stop it.
    const tab = window.open(withBase('/exports/starting'), '_blank');
    setGbkStarting(true);
    void (async () => {
      try {
        const effective = queryOf(returnEntity, sets, setLabels, minPurity, describe).group;
        const res = await apiFetch('/api/search/properties/export-gbk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            group: effective,
            sort: sort ?? undefined,
            email: email?.trim() || undefined,
            searchHref: `/search${window.location.search}`,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.exportJobId) {
          tab?.close();
          setGbkError(data.error || 'Failed to start GBK export');
          return;
        }
        const count = Number(data.count) || 0;
        storeJob(String(data.exportJobId), 'export',
          `GBK export · ${count.toLocaleString()} region${count === 1 ? '' : 's'}`);
        window.dispatchEvent(new Event('bgc-jobs-updated'));
        setGbkDialogOpen(false);
        const href = withBase(`/exports/${data.exportJobId}`);
        if (tab) {
          tab.opener = null;
          tab.location.href = href;
        } else {
          // Popup blocked anyway: the search is in the URL, so Back restores it.
          window.location.href = href;
        }
      } catch (e) {
        tab?.close();
        setGbkError(e instanceof Error ? e.message : 'Failed to start GBK export');
      } finally {
        setGbkStarting(false);
      }
    })();
  };

  // Values go to runSearch explicitly because the setState calls are not readable in this closure yet.
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    const params = new URLSearchParams(window.location.search);
    const r = params.get('ret');
    const entity: Entity = r === 'gcfs' || r === 'samples' ? r : 'bgcs';
    const restored = deserializeFilterGroup(params.get('props'));
    // A family link often has no ?props at all, so the auto-run cannot key off ?props alone.
    const scope = entity === 'gcfs' ? deserializeFamilyScope(params.get('fam')) : null;
    const next = scope ? setsFromScope(restored, scope) : [groupToRows(restored)];
    const labels = scope?.labels ?? [];
    const purity = scope?.minPurity ?? 1;
    setReturnEntity(entity);
    setSets(next);
    setSetLabels(labels);
    setMinPurity(purity);
    if (restored || scope) runSearch(1, { sets: next, entity, labels, minPurity: purity });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Facets are fetched when Refine opens, not with every search: on a broad query they take ~6 s
  // against 0.3 s for the documents.
  useEffect(() => {
    if (!showRefine || !result) return;
    let cancelled = false;
    setFacetsLoading(true);
    apiFetch('/api/search/properties', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // The route clamps size to at least 1; one hit is the cheapest request carrying the aggregations.
      body: JSON.stringify({ group: searchedGroup, page: 1, size: 1, facetFields: defaultFacetFields }),
    })
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setFacets(d.facets ?? {}); })
      .catch(() => { if (!cancelled) setFacets({}); })
      .finally(() => { if (!cancelled) setFacetsLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRefine, searchNonce]);

  const totalPages = result ? Math.max(1, Math.ceil(result.total / pageSize)) : 1;
  const facetEntries = useMemo(
    () => defaultFacetFields.map((f) => [f, facets[f] ?? []] as const).filter(([, b]) => b.length),
    [facets],
  );

  const resultColumns = useMemo(() => propertyResultColumns({ taxRank, setTaxRank })
    .map((c) => (showRefine && HIDDEN_WITH_REFINE.includes(c.id) ? { ...c, visible: false } : c)),
  [taxRank, showRefine]);

  const isFamilies = returnEntity === 'gcfs';
  const multiSet = isFamilies && sets.length > 1;
  const purityLabel = minPurity > 0 && minPurity < 1
    ? `Only families with at least ${Math.round(minPurity * 100)}% of their members matching one of these`
    : 'Only families whose members all match one of these';

  const summary: SummaryRow[] = multiSet
    ? [
      ...sets.filter(rowsHaveRules).map((rows, i): SummaryRow => ({
        joiner: i ? 'AND' : null, lead: 'at least one member: ', parts: rowsExpression(rows, describe),
      })),
      ...(minPurity > 0 && sets.filter(rowsHaveRules).length > 1
        ? [{ joiner: 'AND' as const, lead: minPurity < 1 ? `at least ${Math.round(minPurity * 100)}% of members match one of these` : 'every member matches one of these', parts: [] }]
        : []),
    ]
    : rowsSummary(sets[0] ?? [], describe);

  const setLead = (i: number) => {
    if (returnEntity === 'samples') return 'Samples with at least one BGC where';
    if (isFamilies) return i === 0 ? 'Families with at least one member where' : 'and at least one member where';
    return 'BGCs where';
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-end gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm">
                Examples <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              {EXAMPLES.map((ex) => (
                <DropdownMenuItem key={ex.name} onSelect={() => loadExample(ex)} className="flex flex-col items-start gap-0.5">
                  <span className="text-sm">{ex.name}</span>
                  <span className="text-xs text-muted-foreground">{ex.hint}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <SavedSearchesMenu
            storageKey="bgc-atlas-property-search"
            current={queryOf(returnEntity, sets, setLabels, minPurity, describe).group}
            onLoad={(g) => { setSets([groupToRows(g)]); setSetLabels([]); }}
          />
          <Button type="button" variant="outline" size="sm" onClick={clearAll}>Clear</Button>
        </div>

        <div className="border bg-card">
          {sets.map((rows, i) => (
            <div key={i} className={cn('px-4 pb-4 pt-3', i > 0 && 'border-t')}>
              <div className="mb-2 flex items-center gap-3 text-sm">
                <span>{setLead(i)}</span>
                {i > 0 && (
                  <Button
                    type="button" variant="ghost" size="sm" className="ml-auto"
                    onClick={() => {
                      setSets((prev) => prev.filter((_, j) => j !== i));
                      setSetLabels((prev) => prev.filter((_, j) => j !== i));
                    }}
                  >
                    Remove
                  </Button>
                )}
              </div>
              <QueryRows fields={bgcPropertyFilterFields} rows={rows} onChange={(next) => setRows(i, next)} />
            </div>
          ))}

          {isFamilies && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t px-4 py-3 text-sm">
              {sets.length < MAX_COHORTS && (
                <Button
                  type="button" variant="outline" size="sm"
                  onClick={() => setSets((prev) => [...prev, [conditionRow(createFilterCondition(
                    bgcPropertyFilterFields[0].id, bgcPropertyFilterFields[0].defaultOperator ?? 'in', '',
                  ))]])}
                >
                  + And at least one member where…
                </Button>
              )}
              {multiSet && (
                <label
                  className="inline-flex items-center gap-2"
                  title="Members with no value for the properties asked about are not counted either way."
                >
                  <Checkbox
                    checked={minPurity > 0}
                    onCheckedChange={(on) => setMinPurity(on === true ? 1 : 0)}
                  />
                  {purityLabel}
                </label>
              )}
            </div>
          )}

          <QuerySummary lines={summary} />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button onClick={() => runSearch(1)} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
            Search
          </Button>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            Return
            <div className="inline-flex" role="group" aria-label="Return">
              {([['bgcs', 'BGCs'], ['gcfs', 'Families'], ['samples', 'Samples']] as const).map(([value, label], index) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={returnEntity === value ? 'default' : 'outline'}
                  aria-pressed={returnEntity === value}
                  onClick={() => changeReturnEntity(value)}
                  className={cn('h-8', index === 0 ? 'rounded-r-none' : '-ml-px rounded-l-none')}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
          <CopyLinkButton getHref={shareHref} label="Copy a link to this search" />
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
      )}

      {result && (
        <div className={cn('grid grid-cols-1 gap-6', showRefine && 'lg:grid-cols-[1fr_260px]')}>
          <div className="min-w-0 space-y-3">
            {returnEntity !== 'bgcs' ? (
              <EntityResults group={searchedGroup} entity={returnEntity} nonce={searchNonce}
                familyScope={searchedScope} />
            ) : (
            <Card className="p-0">
            <div className="flex items-center gap-3 px-4 py-3">
              <button
                type="button"
                onClick={() => setShowTable((v) => !v)}
                className="flex items-center gap-2 text-sm font-medium hover:text-foreground/80"
                aria-expanded={showTable}
              >
                <ChevronDown className={cn('h-4 w-4 transition-transform', !showTable && '-rotate-90')} />
                Results
                <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">
                  {result.total.toLocaleString()}
                </span>
              </button>
              <div className="ml-auto flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={() => setShowRefine((v) => !v)}>
                <Filter className="mr-2 h-4 w-4" />
                {showRefine ? 'Hide refine' : 'Refine'}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={exporting}>
                    {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                    Download
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel className="text-xs">This page ({result.hits.length} rows)</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => downloadPage('csv')}>CSV</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => downloadPage('tsv')}>TSV</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => downloadPage('json')}>JSON</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs">All matching (max 100k)</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => downloadAll('csv')}>CSV</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => downloadAll('tsv')}>TSV</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => downloadAll('json')}>JSON</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs">Region files</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => { setGbkError(null); setGbkDialogOpen(true); }}>
                    GBK archive (.zip, max {PROPERTY_GBK_EXPORT_MAX_REGIONS.toLocaleString()} regions)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              </div>
            </div>
            {showTable && (
            <div className="space-y-3 border-t p-3">
            {/* Remounted when Refine toggles: ResizableTable seeds column visibility once. */}
            <ResizableTable<Hit>
              key={showRefine ? 'with-refine' : 'full'}
              columns={resultColumns}
              data={result.hits}
              sortColumn={sort ? columnForSortField(sort.field) : undefined}
              sortDirection={sort?.order}
              onSort={(columnId, direction) => {
                const next: Sort = { field: sortFieldFor(columnId, taxRank), order: direction };
                setSort(next);
                runSearch(1, { sort: next });
              }}
              stickyFirstColumn
              emptyState="No BGCs match this query."
            />

            {result.total > 0 && (
              <Pagination
                currentPage={page - 1}
                totalPages={totalPages}
                totalItems={result.total}
                pageSize={pageSize}
                offset={(page - 1) * pageSize}
                onPageChange={(p0) => runSearch(p0 + 1)}
                onPageSizeChange={(ps) => { setPageSize(ps); runSearch(1, { size: ps }); }}
              />
            )}
            </div>
            )}
            </Card>
            )}

            {/* The panels always describe the matching BGCs, whatever Return is set to. */}
            {returnEntity !== 'bgcs' && (
              <p className="text-xs text-muted-foreground">
                The panels below describe the {result.total.toLocaleString()} matching
                BGC{result.total === 1 ? '' : 's'}, not the grouped {returnEntity === 'gcfs' ? 'GCFs' : 'samples'}.
              </p>
            )}

            <DistributionPanel group={searchedGroup} total={result.total} nonce={searchNonce} onAddFilter={addCondition} />

            <GeoPanel group={searchedGroup} total={result.total} nonce={searchNonce} />
          </div>

          {showRefine && (
          <aside className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium"><Filter className="h-4 w-4" /> Refine</div>
            {facetsLoading && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Counting facets…
              </p>
            )}
            {!facetsLoading && facetEntries.length === 0 && (
              <p className="text-xs text-muted-foreground">No facet counts for this result set.</p>
            )}
            {facetEntries.map(([field, buckets]) => (
              <Card key={field} className="p-3">
                <p className="mb-2 text-xs font-semibold">{fieldLabel.get(field) ?? field}</p>
                <ul className="space-y-1">
                  {buckets.slice(0, 8).map((b) => {
                    const swatch = facetSwatch(field, b.value);
                    return (
                      <li key={b.value}>
                        <button type="button" onClick={() => addFacet(field, b.value)}
                          className="flex w-full items-center justify-between gap-2 rounded-sm px-1 py-0.5 text-left text-xs hover:bg-accent"
                          title={`Add filter: ${facetDisplay(field, b.value)}`}>
                          <span className="flex min-w-0 items-center gap-1.5">
                            {swatch && <span className="inline-block size-2.5 shrink-0 rounded-sm" style={{ background: swatch }} />}
                            <span className="truncate">{facetDisplay(field, b.value)}</span>
                          </span>
                          <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">{b.count.toLocaleString()}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            ))}
          </aside>
          )}
        </div>
      )}

      <Dialog open={gbkDialogOpen} onOpenChange={setGbkDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Download region GBK files</DialogTitle>
            <DialogDescription>
              Packages the region GenBank (.gbk) files of{' '}
              {result && result.total > PROPERTY_GBK_EXPORT_MAX_REGIONS
                ? <>the first {PROPERTY_GBK_EXPORT_MAX_REGIONS.toLocaleString()} of the {result.total.toLocaleString()} matching BGCs, in the current sort order,</>
                : <>the {(result?.total ?? 0).toLocaleString()} matching BGC{result?.total === 1 ? '' : 's'}</>}
              {' '}into a zip.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2.5 rounded-md border border-warning/30 bg-warning/5 p-3 text-sm">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
            <p>
              <span className="font-medium">Large exports can take up to an hour.</span>{' '}
              <span className="text-muted-foreground">
                The job page opens in a new tab and the export keeps running if you close it.
                It stays under Recent Jobs; leave an email to be told when it&apos;s ready.
              </span>
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="gbk-email" className="text-xs">Email (optional)</Label>
            <Input id="gbk-email" type="email" placeholder="you@example.com"
              value={gbkEmail} onChange={(e) => setGbkEmail(e.target.value)} className="h-9" />
          </div>
          {gbkError && <p className="text-sm text-destructive">{gbkError}</p>}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setGbkDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => startGbkExport(gbkEmail)} disabled={gbkStarting}>
              {gbkStarting
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <Download className="mr-2 h-4 w-4" />}
              Start export
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
