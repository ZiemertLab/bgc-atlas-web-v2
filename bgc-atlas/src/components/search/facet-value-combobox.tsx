'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronsUpDown, Loader2, X } from 'lucide-react';
import { apiFetch } from '@/lib/basePath';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface FacetValueComboboxProps {
  field: string;
  multiple: boolean;
  value: string[];
  onChange: (values: string[]) => void;
  invalid?: boolean;
}

interface FacetBucket { value: string; count: number; label?: string; }

// Larger vocabularies (PFAM, GO, taxonomy) show their top values, but typing searches the whole
// vocabulary, so any value is reachable by prefix.
const INITIAL_VALUES = 1000;
const LOAD_STEP = 1000;
const MAX_VALUES = 5000;       // server-capped; beyond this, type to narrow

// Backed by the precomputed vocabulary endpoint (/api/search/properties/facet-values).
export function FacetValueCombobox({ field, multiple, value, onChange, invalid }: FacetValueComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(INITIAL_VALUES);
  const [items, setItems] = useState<FacetBucket[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const res = await apiFetch(
          `/api/search/properties/facet-values?field=${encodeURIComponent(field)}` +
          `&prefix=${encodeURIComponent(query)}&size=${limit}`,
        );
        const data = await res.json();
        setItems(Array.isArray(data.values) ? data.values : []);
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(timer.current);
  }, [query, open, field, limit]);

  const toggle = (v: string) => {
    if (multiple) {
      onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
    } else {
      onChange([v]);
      setOpen(false);
    }
  };

  const label = value.length === 0 ? 'Value' : value.length === 1 ? value[0] : `${value.length} selected`;

  return (
    <div className="flex flex-col gap-1">
      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) { setQuery(''); setLimit(INITIAL_VALUES); } }}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-invalid={invalid ? true : undefined}
            className={cn(
              'h-8 min-w-[200px] max-w-[280px] justify-between text-xs font-normal',
              invalid && 'border-destructive text-destructive focus-visible:ring-destructive/30',
            )}
          >
            <span className="truncate">{label}</span>
            <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start">
          <div className="border-b p-2">
            <Input
              autoFocus
              value={query}
              onChange={(e) => { setQuery(e.target.value); setLimit(INITIAL_VALUES); }}
              placeholder="Type to search values…"
              className="h-8 text-xs"
            />
          </div>
          <div className="max-h-72 overflow-y-auto p-1">
            {loading && (
              <p className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
              </p>
            )}
            {!loading && items.length === 0 && (
              <p className="px-2 py-3 text-xs text-muted-foreground">No matching values</p>
            )}
            {!loading && items.map((it) => {
              const sel = value.includes(it.value);
              return (
                <button
                  key={it.value}
                  type="button"
                  onClick={() => toggle(it.value)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent',
                    sel && 'bg-accent',
                  )}
                >
                  {multiple && (
                    <span className={cn(
                      'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border',
                      sel ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                    )}>
                      {sel && <Check className="h-2.5 w-2.5" />}
                    </span>
                  )}
                  <span className="flex-1 truncate">
                    {it.value}
                    {/* Secondary label, e.g. a GCF's pet name; the stored value is always it.value. */}
                    {it.label && (
                      <span className="ml-1.5 text-muted-foreground">{it.label}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {it.count.toLocaleString()}
                  </span>
                </button>
              );
            })}
            {!loading && items.length >= limit && limit < MAX_VALUES && (
              <button
                type="button"
                onClick={() => setLimit((l) => Math.min(l + LOAD_STEP, MAX_VALUES))}
                className="w-full rounded-sm px-2 py-1.5 text-center text-xs font-medium text-primary hover:bg-accent"
              >
                Load more ({items.length.toLocaleString()} shown)
              </button>
            )}
            {!loading && items.length >= MAX_VALUES && (
              <p className="px-2 py-1.5 text-[10px] italic text-muted-foreground">
                Showing top {MAX_VALUES.toLocaleString()} by frequency — type to narrow.
              </p>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {multiple && value.length > 0 && (
        <div className="flex max-w-[280px] flex-wrap gap-1">
          {value.map((v) => (
            <Badge key={v} variant="secondary" className="max-w-full text-[10px]">
              <span className="truncate">{v}</span>
              <button type="button" onClick={() => toggle(v)} className="ml-1 hover:opacity-70">
                <X className="h-2.5 w-2.5" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
