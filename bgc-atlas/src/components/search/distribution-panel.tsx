'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { BarChart3, ChevronDown, ExternalLink, Loader2, Plus, SlidersHorizontal, X } from 'lucide-react';
import { apiFetch } from '@/lib/basePath';
import { bucketLink } from '@/lib/utils/bucket-links';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { TieredFieldPicker } from '@/components/search/tiered-field-picker';
import {
  bgcPropertyFilterFields, booleanFacetFields, booleanFacetLabel, facetValueCondition,
  MAX_DISTRIBUTION_FIELDS, plottableFields,
} from '@/lib/filters/bgc-property-fields';
import { getProductCategoryColor } from '@/lib/utils/chart-utils';
import { formatGOLDBreadcrumb, getEcosystemChartColorHex } from '@/lib/utils/gold-parser';
import {
  createFilterCondition, type FilterCondition, type FilterGroup,
} from '@/lib/filters/types';

interface DistBucket { key: string; count: number; label?: string; }
interface DistResult {
  field: string;
  kind: 'terms' | 'histogram';
  total: number;
  missing: number;
  other: number;
  interval?: number;
  buckets: DistBucket[];
}

interface DistributionPanelProps {
  /** The query the table is showing, with its filters folded in. */
  group: FilterGroup | null;
  total: number;
  /** Bumps on every search run. */
  nonce: number;
  /** Adds to the query builder; does not run the search. */
  onAddFilter: (condition: FilterCondition) => void;
}

const FETCH_SIZE = 50; // the UI slices this to Top-N
const TOP_N_OPTIONS = [10, 20, 50];

const plottableSet = new Set(plottableFields);
const PLOTTABLE = bgcPropertyFilterFields.filter((f) => plottableSet.has(f.id));
const fieldLabel = new Map(bgcPropertyFilterFields.map((f) => [f.id, f.label]));

const EXAMPLE_FIELDS = ['gold_ecosystem', 'product_category', 'product', 'tax_phylum', 'sample_type', 'biome', 'length'];

const stripRank = (s: string) => s.replace(/^[a-z]__/, '');
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

// Compact notation only for large magnitudes, so a collection_year never renders as "2K".
function fmtAxis(n: number): string {
  if (!Number.isFinite(n)) return '';
  const a = Math.abs(n);
  if (a === 0) return '0';
  if (a < 1) return n.toFixed(2);
  if (a < 10) return String(Math.round(n * 10) / 10);
  if (a < 10000) return String(Math.round(n));
  return compact.format(n);
}

function bucketLabel(field: string, value: string): string {
  if (booleanFacetFields.has(field)) return booleanFacetLabel(field, value);
  if (field === 'gold_ecosystem') return formatGOLDBreadcrumb(value) || value;
  return stripRank(value) || '(empty)';
}

function barColor(field: string, value: string): string {
  if (field === 'product_category') return getProductCategoryColor(value);
  if (field === 'gold_ecosystem') return getEcosystemChartColorHex(value);
  // A yes/no property is not an outcome: ink for yes, grey for no, never status colours.
  if (booleanFacetFields.has(field)) return value === '1' || value === 'true' ? 'var(--foreground)' : 'var(--muted-foreground)';
  return 'var(--primary)'; // tokens are oklch(), not HSL triplets
}

// The operator belongs to the field (a boolean field answers `equals`, never `in`), so ask the catalog.
const termCondition = (field: string, value: string): FilterCondition =>
  facetValueCondition(field, value);

// Links the label when the value names something with a page; the bar and "+" keep their meaning.
function BucketLabel({ field, value, label }: { field: string; value: string; label: string }) {
  const link = bucketLink(field, value, label);
  if (!link) return <>{label}</>;

  const className = 'inline-flex max-w-full items-center gap-1 underline-offset-2 hover:text-foreground hover:underline';
  const body = (
    <>
      <span className="truncate">{label}</span>
      {link.external && <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-60" />}
    </>
  );

  // Internal targets go through next/link so the deploy basePath is applied.
  return link.external ? (
    <a href={link.href} target="_blank" rel="noopener noreferrer" title={link.title} className={className}>
      {body}
    </a>
  ) : (
    <Link href={link.href} target="_blank" rel="noopener noreferrer" title={link.title} className={className}>
      {body}
    </Link>
  );
}

function TermsChart({ data, topN, onTopN, onAddFilter }: {
  data: DistResult; topN: number; onTopN: (n: number) => void;
  onAddFilter: (c: FilterCondition) => void;
}) {
  const shown = data.buckets.slice(0, topN);
  const max = shown.reduce((m, b) => Math.max(m, b.count), 0) || 1;
  const shownSum = shown.reduce((s, b) => s + b.count, 0);
  // Everything matched but not displayed as a bar: trimmed buckets + the server's tail.
  const others = Math.max(0, data.total - data.missing - shownSum);
  const pct = (n: number) => (data.total ? ((n / data.total) * 100) : 0);

  return (
    <div className="space-y-1.5">
      {shown.length === 0 && (
        <p className="py-3 text-center text-xs text-muted-foreground">No values in this result set.</p>
      )}
      {shown.map((b) => {
        const label = b.label ?? bucketLabel(data.field, b.key);
        return (
          <div key={b.key} className="group flex items-center gap-2">
            <span className="w-[42%] shrink-0 truncate text-[11px]" title={label}>
              <BucketLabel field={data.field} value={b.key} label={label} />
            </span>
            <div className="relative h-3.5 flex-1 overflow-hidden rounded-sm bg-muted/50">
              <div className="h-full rounded-sm" style={{ width: `${(b.count / max) * 100}%`, backgroundColor: barColor(data.field, b.key) }} />
            </div>
            <span className="w-14 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground"
              title={`${b.count.toLocaleString()} (${pct(b.count).toFixed(1)}%)`}>
              {compact.format(b.count)}
            </span>
            <button
              type="button"
              onClick={() => onAddFilter(termCondition(data.field, b.key))}
              title={`Add filter: ${fieldLabel.get(data.field) ?? data.field} = ${label}`}
              className="shrink-0 rounded-sm p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus:opacity-100 group-hover:opacity-100"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
        );
      })}
      <div className="flex items-center justify-between pt-1 text-[10px] text-muted-foreground">
        <span>
          {others > 0 && <>+{compact.format(others)} others</>}
          {others > 0 && data.missing > 0 && ' · '}
          {data.missing > 0 && <>{compact.format(data.missing)} unset</>}
        </span>
        {data.buckets.length > TOP_N_OPTIONS[0] && (
          <span className="flex items-center gap-1">
            <SlidersHorizontal className="h-3 w-3" />
            {TOP_N_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onTopN(n)}
                className={cn('rounded px-1 tabular-nums hover:text-foreground', topN === n && 'font-semibold text-foreground')}
              >
                {n}
              </button>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

function HistogramChart({ data, onAddFilter }: {
  data: DistResult; onAddFilter: (c: FilterCondition) => void;
}) {
  const bins = data.buckets;
  const max = bins.reduce((m, b) => Math.max(m, b.count), 0) || 1;
  const interval = data.interval ?? 0;
  const lo = bins.length ? Number(bins[0].key) : 0;
  const hi = bins.length ? Number(bins[bins.length - 1].key) + interval : 0;
  const pct = (n: number) => (data.total ? ((n / data.total) * 100) : 0);
  const shownSum = bins.reduce((s, b) => s + b.count, 0);
  // Docs outside the p1–p99 window are clipped from the bars (still in the total).
  const clipped = Math.max(0, data.total - data.missing - shownSum);

  if (!bins.length) {
    return <p className="py-3 text-center text-xs text-muted-foreground">No numeric values in this result set.</p>;
  }
  const yTicks = [max, max / 2, 0];
  const xTicks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4);

  return (
    <div className="space-y-1">
      <div className="flex gap-1.5">
        <div className="flex h-28 w-9 shrink-0 flex-col justify-between py-0 text-right text-[9px] tabular-nums text-muted-foreground">
          {yTicks.map((t, i) => <span key={i} className="leading-none">{compact.format(t)}</span>)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex h-28 items-end gap-[2px] border-b border-l border-border">
            {bins.map((b) => {
              const start = Number(b.key);
              const end = start + interval;
              return (
                <button
                  key={b.key}
                  type="button"
                  onClick={() => onAddFilter(createFilterCondition(data.field, 'between' as never, [String(start), String(end)] as never))}
                  title={`${fmtAxis(start)}–${fmtAxis(end)}: ${b.count.toLocaleString()} (${pct(b.count).toFixed(1)}%)`}
                  className="group flex-1 rounded-t-sm bg-primary opacity-80 transition-opacity hover:opacity-100"
                  style={{ height: `${Math.max(b.count > 0 ? 2 : 0, (b.count / max) * 100)}%` }}
                />
              );
            })}
          </div>
          <div className="mt-1 flex justify-between text-[9px] tabular-nums text-muted-foreground">
            {xTicks.map((t, i) => <span key={i} className="leading-none">{fmtAxis(t)}</span>)}
          </div>
        </div>
      </div>
      {(clipped > 0 || data.missing > 0) && (
        <p className="pl-[42px] text-[10px] text-muted-foreground">
          {[
            clipped > 0 ? `${compact.format(clipped)} outside range` : '',
            data.missing > 0 ? `${compact.format(data.missing)} unset` : '',
          ].filter(Boolean).join(' · ')}
        </p>
      )}
    </div>
  );
}

export function DistributionPanel({ group, total, nonce, onAddFilter }: DistributionPanelProps) {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<string[]>([]);
  const [topN, setTopN] = useState<Record<string, number>>({});
  const [data, setData] = useState<Record<string, DistResult>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  const fieldsKey = fields.join(',');

  const fetchDistributions = useCallback(async () => {
    if (!fields.length) { setData({}); return; }
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/search/properties/aggregate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group, fields, size: FETCH_SIZE }),
      });
      const body = await res.json();
      if (id !== reqId.current) return; // a newer request superseded this one
      if (!res.ok) { setError(body.error || 'Failed to compute distributions'); return; }
      const next: Record<string, DistResult> = {};
      for (const r of (body.results ?? []) as DistResult[]) next[r.field] = r;
      setData(next);
    } catch (e) {
      if (id === reqId.current) setError(e instanceof Error ? e.message : 'Failed to compute distributions');
    } finally {
      if (id === reqId.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, fieldsKey]);

  useEffect(() => {
    if (!open) return;
    fetchDistributions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, nonce, fieldsKey]);

  const addField = (field: string) => {
    // The route computes only the first MAX_DISTRIBUTION_FIELDS per request; the rest would spin forever.
    setFields((prev) => (
      prev.includes(field) || prev.length >= MAX_DISTRIBUTION_FIELDS ? prev : [...prev, field]
    ));
    setTopN((prev) => (prev[field] ? prev : { ...prev, [field]: TOP_N_OPTIONS[1] }));
  };
  const removeField = (field: string) => {
    setFields((prev) => prev.filter((f) => f !== field));
    setData((prev) => { const n = { ...prev }; delete n[field]; return n; });
  };
  const clearAll = () => { setFields([]); setData({}); setTopN({}); };

  const available = useMemo(() => PLOTTABLE.filter((f) => !fields.includes(f.id)), [fields]);

  return (
    <Card className="p-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium hover:bg-accent/40"
        aria-expanded={open}
      >
        <ChevronDown className={cn('h-4 w-4 transition-transform', !open && '-rotate-90')} />
        <BarChart3 className="h-4 w-4" />
        Distributions
        {fields.length > 0 && (
          <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">{fields.length}</span>
        )}
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          across all {total.toLocaleString()} matching BGCs
        </span>
      </button>

      {open && (
        <div className="space-y-4 border-t px-4 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Plot distribution of:</span>
            <TieredFieldPicker
              fields={available}
              onChange={addField}
              placeholder="Add a field…"
              className="min-w-[200px]"
            />
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            {fields.length >= MAX_DISTRIBUTION_FIELDS && (
              <span className="text-xs text-muted-foreground">
                {MAX_DISTRIBUTION_FIELDS} charts is the limit — remove one to add another.
              </span>
            )}
            {fields.length > 0 && (
              <button
                type="button"
                onClick={clearAll}
                className="ml-auto text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Clear all
              </button>
            )}
          </div>

          {EXAMPLE_FIELDS.some((f) => !fields.includes(f)) && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground">Examples:</span>
              {EXAMPLE_FIELDS.filter((f) => !fields.includes(f)).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => addField(f)}
                  className="rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-primary hover:bg-primary/10"
                >
                  {fieldLabel.get(f) ?? f}
                </button>
              ))}
            </div>
          )}

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">{error}</div>
          )}

          {fields.length === 0 && !error && (
            <p className="text-xs text-muted-foreground">
              Pick a field above to chart how it&apos;s distributed across the full result set —
              GOLD ecosystem, taxonomy, product and category, sample type, and more. Counts are
              computed over every matching BGC, not just the current page.
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {fields.map((field) => {
              const d = data[field];
              return (
                <Card key={field} className="p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <p className="truncate text-xs font-semibold" title={fieldLabel.get(field) ?? field}>
                      {fieldLabel.get(field) ?? field}
                    </p>
                    <button
                      type="button"
                      onClick={() => removeField(field)}
                      className="ml-auto rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                      title="Remove chart"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {!d ? (
                    <div className="flex h-24 items-center justify-center px-2 text-center">
                      {loading ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : (
                        // Not computed is not "still computing", so no spinner.
                        <p className="text-xs text-muted-foreground">
                          Not computed — at most {MAX_DISTRIBUTION_FIELDS} charts at a time.
                        </p>
                      )}
                    </div>
                  ) : d.kind === 'histogram' ? (
                    <HistogramChart data={d} onAddFilter={onAddFilter} />
                  ) : (
                    <TermsChart
                      data={d}
                      topN={topN[field] ?? TOP_N_OPTIONS[1]}
                      onTopN={(n) => setTopN((prev) => ({ ...prev, [field]: n }))}
                      onAddFilter={onAddFilter}
                    />
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}
