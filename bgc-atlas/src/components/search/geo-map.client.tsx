'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import type { Map as LeafletMap } from 'leaflet';
import { CircleMarker, MapContainer, Popup, TileLayer, Tooltip, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

import { BASEMAP_ATTRIBUTION, BASEMAP_SUBDOMAINS, BASEMAP_URL } from '@/lib/basemap';
import type { GeoCell } from '@/lib/opensearch/client';
import { cellBounds, cellCenter } from '@/lib/opensearch/geo-grid';
import { legendColor, legendLabel, legendStroke } from '@/components/search/geo-colors';

export interface GeoView {
  zoom: number;
  bbox: { latMin: number; latMax: number; lonMin: number; lonMax: number };
}

interface GeoMapProps {
  cells: GeoCell[];
  interval: number;
  legendKeys: string[];
  colorField: string | null;
  /** Fired on pan/zoom (already debounced by the panel). */
  onViewChange: (view: GeoView) => void;
  height?: number;
}

const MIN_R = 3;
const MAX_R = 14;

/** √count radius, so dot area grows linearly with the count. */
function radiusFor(count: number, max: number): number {
  if (max <= 0) return MIN_R;
  return MIN_R + (MAX_R - MIN_R) * Math.sqrt(count / max);
}

// Trailing zeros dropped so a whole-degree cell reads "35°N".
const fmtCoord = (n: number) => `${Math.abs(n).toFixed(2).replace(/\.?0+$/, '')}°`;

function boundsLabel(b: { latMin: number; latMax: number; lonMin: number; lonMax: number }): string {
  const lat = `${fmtCoord(b.latMin)}${b.latMin < 0 ? 'S' : 'N'}–${fmtCoord(b.latMax)}${b.latMax < 0 ? 'S' : 'N'}`;
  const lon = `${fmtCoord(b.lonMin)}${b.lonMin < 0 ? 'W' : 'E'}–${fmtCoord(b.lonMax)}${b.lonMax < 0 ? 'W' : 'E'}`;
  return `${lat}, ${lon}`;
}

/** Leaflet owns the view; the panel never drives it back, so there is no feedback loop. */
function ViewReporter({ onViewChange }: { onViewChange: (view: GeoView) => void }) {
  const report = (map: LeafletMap) => {
    const b = map.getBounds();
    onViewChange({
      zoom: map.getZoom(),
      bbox: {
        latMin: b.getSouth(), latMax: b.getNorth(),
        lonMin: b.getWest(), lonMax: b.getEast(),
      },
    });
  };
  useMapEvents({
    moveend: (e) => report(e.target as LeafletMap),
    zoomend: (e) => report(e.target as LeafletMap),
  });
  return null;
}

export function GeoMap({ cells, interval, legendKeys, colorField, onViewChange, height = 460 }: GeoMapProps) {
  const max = useMemo(() => cells.reduce((m, c) => Math.max(m, c[2]), 0), [cells]);

  return (
    <MapContainer
      center={[20, 0]}
      zoom={2}
      minZoom={2}
      maxZoom={13}
      worldCopyJump
      scrollWheelZoom
      style={{ height, width: '100%', background: 'var(--card)' }}
    >
      <TileLayer
        url={BASEMAP_URL}
        subdomains={BASEMAP_SUBDOMAINS}
        attribution={BASEMAP_ATTRIBUTION}
      />
      <ViewReporter onViewChange={onViewChange} />

      {cells.map(([lat, lon, count, dom, pairs]) => {
        const key = dom >= 0 ? legendKeys[dom] ?? '' : '';
        const stroke = legendStroke(colorField, key);
        const bounds = cellBounds(lat, lon, interval);
        const area = new URLSearchParams({
          latMin: String(bounds.latMin), latMax: String(bounds.latMax),
          lonMin: String(bounds.lonMin), lonMax: String(bounds.lonMax),
        }).toString();

        return (
          <CircleMarker
            key={`${lat}:${lon}`}
            center={cellCenter(lat, lon, interval)}
            radius={radiusFor(count, max)}
            pathOptions={{
              color: stroke.color,
              weight: stroke.weight,
              fillColor: dom >= 0 ? legendColor(colorField, key, dom) : 'var(--primary)',
              fillOpacity: 0.78,
            }}
          >
            <Tooltip direction="top" offset={[0, -4]} opacity={1} className="geo-cell-tooltip">
              <div className="space-y-1">
                <p className="font-semibold tabular-nums">{count.toLocaleString()} BGCs</p>
                <p className="text-[11px] opacity-70">{boundsLabel(bounds)}</p>
                {pairs.length > 0 && (
                  <ul className="space-y-0.5 pt-0.5">
                    {pairs.slice(0, 5).map(([idx, n]) => (
                      <li key={idx} className="flex items-center gap-1.5 text-[11px]">
                        <span
                          className="inline-block size-2 shrink-0 rounded-sm"
                          style={{ background: legendColor(colorField, legendKeys[idx] ?? '', idx) }}
                        />
                        <span className="truncate">{legendLabel(colorField, legendKeys[idx] ?? '')}</span>
                        <span className="ml-auto tabular-nums opacity-70">
                          {Math.round((n / count) * 100)}%
                        </span>
                      </li>
                    ))}
                    {pairs.length > 5 && (
                      <li className="text-[11px] opacity-60">+{pairs.length - 5} more</li>
                    )}
                  </ul>
                )}
              </div>
            </Tooltip>

            <Popup className="geo-cell-popup">
              <div className="space-y-1.5">
                <p className="text-xs font-semibold tabular-nums">
                  {count.toLocaleString()} matching BGCs here
                </p>
                <p className="text-[11px] opacity-70">{boundsLabel(bounds)}</p>
                {/* /samples covers metagenomes and /genome-collections the genomes, so offer both. Neither carries the property query. */}
                <div className="flex flex-col gap-1 pt-0.5">
                  <Link
                    href={`/samples?${area}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs underline underline-offset-2"
                  >
                    View metagenomes in this area →
                  </Link>
                  <Link
                    href={`/genome-collections?${area}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs underline underline-offset-2"
                  >
                    View genomes in this area →
                  </Link>
                </div>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
