"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";

export interface AreaBounds {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

interface MapAreaSelectProps {
  /** `samples` is exact; `bgcs` is a per-sample sum (an upper bound). */
  countInBounds: (b: AreaBounds) => { samples: number; bgcs: number };
  onViewSamples: (b: AreaBounds) => void;
  onViewBgcs: (b: AreaBounds) => void;
  /** Push the control below the place-search box sharing the corner. */
  offsetTop?: boolean;
}

function normalize(a: L.LatLng, b: L.LatLng): AreaBounds {
  const clampLon = (x: number) => Math.max(-180, Math.min(180, x));
  return {
    latMin: Math.min(a.lat, b.lat),
    latMax: Math.max(a.lat, b.lat),
    lonMin: clampLon(Math.min(a.lng, b.lng)),
    lonMax: clampLon(Math.max(a.lng, b.lng)),
  };
}

export function MapAreaSelect({ countInBounds, onViewSamples, onViewBgcs, offsetTop = false }: MapAreaSelectProps) {
  const map = useMap();
  const [active, setActive] = useState(false);
  const [bounds, setBounds] = useState<AreaBounds | null>(null);
  const rectRef = useRef<L.Rectangle | null>(null);
  const startRef = useRef<L.LatLng | null>(null);
  const drawingRef = useRef(false);

  const clearRect = useCallback(() => {
    if (rectRef.current) {
      rectRef.current.remove();
      rectRef.current = null;
    }
  }, []);

  useEffect(() => {
    const container = map.getContainer();
    if (active) {
      map.dragging.disable();
      map.doubleClickZoom.disable();
      map.boxZoom.disable();
      container.style.cursor = "crosshair";
    } else {
      map.dragging.enable();
      map.doubleClickZoom.enable();
      map.boxZoom.enable();
      container.style.cursor = "";
    }
    return () => {
      container.style.cursor = "";
    };
  }, [active, map]);

  useEffect(() => {
    if (!active) return;
    const onDown = (e: L.LeafletMouseEvent) => {
      drawingRef.current = true;
      startRef.current = e.latlng;
      clearRect();
      // Coloured in map.css (.map-area-selection) from --brand, not the status red.
      rectRef.current = L.rectangle(L.latLngBounds(e.latlng, e.latlng), {
        className: "map-area-selection",
        weight: 2,
        fillOpacity: 0.12,
        interactive: false,
      }).addTo(map);
    };
    const onMove = (e: L.LeafletMouseEvent) => {
      if (!drawingRef.current || !startRef.current || !rectRef.current) return;
      const b = normalize(startRef.current, e.latlng);
      rectRef.current.setBounds(L.latLngBounds([b.latMin, b.lonMin], [b.latMax, b.lonMax]));
      setBounds(b);
    };
    const onUp = () => {
      if (drawingRef.current) drawingRef.current = false;
    };
    map.on("mousedown", onDown);
    map.on("mousemove", onMove);
    map.on("mouseup", onUp);
    return () => {
      map.off("mousedown", onDown);
      map.off("mousemove", onMove);
      map.off("mouseup", onUp);
    };
  }, [active, map, clearRect]);

  useEffect(() => clearRect, [clearRect]);

  const toggle = () => {
    if (active) {
      setActive(false);
      setBounds(null);
      clearRect();
    } else {
      setActive(true);
    }
  };

  const counts = bounds ? countInBounds(bounds) : null;
  const stop = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  return (
    // Click-through wrapper so it never intercepts a draw mousedown; the stop handlers keep
    // control clicks from starting a selection.
    <div
      className="leaflet-top leaflet-right"
      style={{ pointerEvents: "none" }}
      onMouseDown={stop}
      onClick={stop}
    >
      <div
        className="leaflet-control m-2 rounded-sm border border-border bg-card/95 shadow-sm"
        // Inline style: Leaflet's `.leaflet-top .leaflet-control` out-specifies utility classes.
        style={{ pointerEvents: "auto", marginTop: offsetTop ? "3.25rem" : undefined }}
      >
        <button
          type="button"
          onClick={toggle}
          aria-pressed={active}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium text-foreground"
        >
          <span aria-hidden className="inline-block size-3 border border-dashed border-foreground" />
          {active ? (bounds ? "Redraw or cancel" : "Drag to select · cancel") : "Select area"}
        </button>
        {active && bounds && counts ? (
          <div className="border-t border-border px-2.5 py-2 text-[11.5px]">
            <div className="font-mono tabular-nums text-muted-foreground">
              {/* The BGC count is a per-sample sum and can exceed the de-duplicated list count. */}
              {counts.samples.toLocaleString()} samples · ~{counts.bgcs.toLocaleString()} BGCs
            </div>
            <div className="mt-1.5 flex gap-1.5">
              <button
                type="button"
                onClick={() => onViewSamples(bounds)}
                className="rounded-sm bg-foreground px-2 py-1 text-[11px] font-medium text-background"
              >
                View samples →
              </button>
              <button
                type="button"
                onClick={() => onViewBgcs(bounds)}
                className="rounded-sm border border-border px-2 py-1 text-[11px] font-medium text-foreground"
              >
                View BGCs →
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
