'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { BASEMAP_ATTRIBUTION, BASEMAP_SUBDOMAINS, BASEMAP_URL } from '@/lib/basemap';

interface Props {
  latitude: number;
  longitude: number;
  label?: string;
  height?: number;
}

// Matches --brand; inline because Leaflet marker HTML is outside Tailwind's reach.
const BRAND = '#A51E37';

export default function SampleLocationMapClient({ latitude, longitude, label, height = 280 }: Props) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const el = elRef.current;

    const map = L.map(el, {
      center: [latitude, longitude],
      zoom: 4,
      // Below minZoom the container exceeds one world copy and Leaflet paints repeats.
      minZoom: 2,
      maxBounds: [
        [-85.05, -180],
        [85.05, 180],
      ],
      maxBoundsViscosity: 1,
      scrollWheelZoom: false, // avoid hijacking page scroll inside the expander
    });
    mapRef.current = map;

    L.tileLayer(BASEMAP_URL, {
      subdomains: BASEMAP_SUBDOMAINS,
      noWrap: true,
      maxZoom: 13,
      attribution: BASEMAP_ATTRIBUTION,
    }).addTo(map);

    const marker = L.marker([latitude, longitude], {
      icon: L.divIcon({
        className: '',
        html: `<div style="width:14px;height:14px;border-radius:50%;background:${BRAND};border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,0.35)"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      }),
    }).addTo(map);

    if (label) marker.bindTooltip(label, { direction: 'top', offset: [0, -8] });

    // Inside a collapsed/animating expander the container can measure 0×0; re-measure on resize.
    // invalidateSize() keeps the center, so no setView (which would fight a pan).
    const ro = new ResizeObserver(() => {
      map.invalidateSize();
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // Re-init when the plotted point changes (a different row reuses the component).
  }, [latitude, longitude, label]);

  return <div ref={elRef} style={{ height }} className="isolate w-full overflow-hidden rounded-md border border-border" />;
}
