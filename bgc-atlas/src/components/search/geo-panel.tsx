'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { ChevronDown, Loader2, MapPin } from 'lucide-react';
import { apiFetch } from '@/lib/basePath';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { FilterGroup } from '@/lib/filters/types';
import type { GeoCell } from '@/lib/opensearch/client';
import { GEO_COLOR_FIELDS } from '@/lib/opensearch/geo-grid';
import { legendColor, legendLabel } from '@/components/search/geo-colors';
import type { GeoView } from '@/components/search/geo-map.client';

const MAP_HEIGHT = 460;

// Leaflet touches `window` at import time, so the map only loads in the browser.
const GeoMap = dynamic(() => import('@/components/search/geo-map.client').then((m) => m.GeoMap), {
  ssr: false,
  loading: () => (
    <div
      className="flex items-center justify-center bg-muted/30 text-sm text-muted-foreground"
      style={{ height: MAP_HEIGHT }}
    >
      Loading map…
    </div>
  ),
});

interface GeoGridResponse {
  interval: number;
  hits: number;
  colorField: string | null;
  legendKeys: string[];
  cells: GeoCell[];
  coarsened: boolean;
}

interface GeoPanelProps {
  /** The query the table is showing, with its filters folded in. */
  group: FilterGroup | null;
  /** Includes BGCs with no coordinates. */
  total: number;
  /** Bumps on every search run. */
  nonce: number;
}

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const VIEW_DEBOUNCE_MS = 350;

function intervalLabel(interval: number): string {
  return interval >= 1 ? `${interval}°` : `${interval}° (~${Math.round(interval * 111)} km)`;
}

export function GeoPanel({ group, total, nonce }: GeoPanelProps) {
  const [open, setOpen] = useState(false);
  const [colorField, setColorField] = useState<string>(GEO_COLOR_FIELDS[0].id);
  const [data, setData] = useState<GeoGridResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Across the whole result set, from the unbounded first fetch. */
  const [geolocated, setGeolocated] = useState<number | null>(null);

  const viewRef = useRef<GeoView | null>(null);
  const reqId = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const fetchGrid = useCallback(async (view: GeoView | null) => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/search/properties/geo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group,
          colorField,
          zoom: view?.zoom ?? 2,
          bbox: view?.bbox ?? null,
        }),
      });
      const body = await res.json();
      if (id !== reqId.current) return; // a newer request superseded this one
      if (!res.ok) { setError(body.error || 'Failed to build the map'); return; }
      setData(body as GeoGridResponse);
    } catch (e) {
      if (id === reqId.current) setError(e instanceof Error ? e.message : 'Failed to build the map');
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [group, colorField]);

  // Re-runs keep the current viewport: a colour change must not yank the map back to the world.
  useEffect(() => {
    if (!open) return;
    fetchGrid(viewRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, nonce, colorField]);

  // Coverage is a property of the whole result set, so it is counted without the grid, per query.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setGeolocated(null);
    apiFetch('/api/search/properties/geo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group, countOnly: true }),
    })
      .then((res) => res.json())
      .then((body) => { if (!cancelled && typeof body?.hits === 'number') setGeolocated(body.hits); })
      .catch(() => { /* the coverage readout just stays unstated */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, nonce]);

  const handleViewChange = useCallback((view: GeoView) => {
    viewRef.current = view;
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => fetchGrid(view), VIEW_DEBOUNCE_MS);
  }, [fetchGrid]);

  useEffect(() => () => clearTimeout(debounce.current), []);

  const toggle = () => {
    // Collapsing unmounts the map and it remounts at the world view, so forget the old viewport.
    if (open) viewRef.current = null;
    setOpen((v) => !v);
  };

  // From the cells actually drawn, so the counts add up to what is on screen.
  const legend = useMemo(() => {
    if (!data) return [];
    const counts = new Array<number>(data.legendKeys.length).fill(0);
    for (const cell of data.cells) {
      for (const [idx, n] of cell[4]) counts[idx] = (counts[idx] ?? 0) + n;
    }
    return data.legendKeys
      .map((key, idx) => ({ key, idx, count: counts[idx] ?? 0 }))
      .filter((e) => e.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [data]);

  const shown = data?.hits ?? 0;
  const withoutCoords = geolocated === null ? null : Math.max(0, total - geolocated);

  return (
    <Card className="p-0">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium hover:bg-accent/40"
        aria-expanded={open}
      >
        <ChevronDown className={cn('h-4 w-4 transition-transform', !open && '-rotate-90')} />
        <MapPin className="h-4 w-4" />
        Map
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          {geolocated === null
            ? `across all ${total.toLocaleString()} matching BGCs`
            : `${geolocated.toLocaleString()} of ${total.toLocaleString()} matching BGCs are geolocated`}
        </span>
      </button>

      {open && (
        <div className="space-y-3 border-t px-4 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="geo-color-field" className="text-xs text-muted-foreground">Colour by:</label>
            <select
              id="geo-color-field"
              value={colorField}
              onChange={(e) => setColorField(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              {GEO_COLOR_FIELDS.map((f) => (
                <option key={f.id} value={f.id}>{f.label}</option>
              ))}
            </select>
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            {data && (
              <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                {data.cells.length.toLocaleString()} cells of {intervalLabel(data.interval)}
                {' · '}
                {compact.format(shown)} BGCs in view
                {data.coarsened && ' · coarsened to fit'}
              </span>
            )}
          </div>

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">{error}</div>
          )}

          <div className="overflow-hidden rounded-md border border-border">
            <GeoMap
              cells={data?.cells ?? []}
              interval={data?.interval ?? 5}
              legendKeys={data?.legendKeys ?? []}
              colorField={data?.colorField ?? colorField}
              onViewChange={handleViewChange}
              height={MAP_HEIGHT}
            />
          </div>

          {legend.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {legend.map(({ key, idx, count }) => (
                <span key={key} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span
                    className="inline-block size-2.5 shrink-0 rounded-sm"
                    style={{ background: legendColor(colorField, key, idx) }}
                  />
                  <span className="text-foreground">{legendLabel(colorField, key)}</span>
                  <span className="tabular-nums">{compact.format(count)}</span>
                </span>
              ))}
            </div>
          )}

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Dots are grid cells sized by BGC count and filled with the most common value in
            that cell; hover for the full breakdown, click for the samples behind it. Zooming
            in re-aggregates at a finer resolution.
            {withoutCoords !== null && withoutCoords > 0 && (
              <> {withoutCoords.toLocaleString()} matching BGCs come from samples with no
                coordinates and cannot be mapped.</>
            )}
          </p>
        </div>
      )}
    </Card>
  );
}
