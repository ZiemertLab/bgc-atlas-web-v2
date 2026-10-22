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
  /** Omitted: no "view samples" button. */
  onViewSamples?: (b: AreaBounds) => void;
  /** Omitted: no "view BGCs" button. */
  onViewBgcs?: (b: AreaBounds) => void;
  /** Push the control below the place-search box sharing the corner. */
  offsetTop?: boolean;
}

/**
 * A drawn box narrower or shorter than this, in screen pixels, is a click
 * rather than a selection, and is dropped instead of querying a zero-area box.
 */
const MIN_BOX_PX = 4;

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
  const lastRef = useRef<L.LatLng | null>(null);
  const drawingRef = useRef(false);
  const controlRef = useRef<HTMLDivElement | null>(null);

  // Keep presses and scrolls on the control from reaching the map. Without
  // this, pressing "View samples" also starts a new selection at the button,
  // and a single mousemove before the click shrinks the box to that point.
  // React's stopPropagation can't prevent it: Leaflet's listener is on the
  // map container, which the native event reaches before React's root.
  useEffect(() => {
    const el = controlRef.current;
    if (!el) return;
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);
  }, []);

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

  // The release is heard on the window: a drag that ends past the map's edge never
  // reaches the map, and the draw would carry on until the next click.
  useEffect(() => {
    if (!active) return;
    const onDown = (e: L.LeafletMouseEvent) => {
      // With map dragging off, nothing else stops the browser treating the
      // drag as a text selection across the page, so block it as Leaflet's
      // own Draggable does.
      e.originalEvent.preventDefault();
      if (!drawingRef.current) L.DomUtil.disableTextSelection();
      drawingRef.current = true;
      startRef.current = e.latlng;
      lastRef.current = e.latlng;
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
      lastRef.current = e.latlng;
      const b = normalize(startRef.current, e.latlng);
      rectRef.current.setBounds(L.latLngBounds([b.latMin, b.lonMin], [b.latMax, b.lonMax]));
      setBounds(b);
    };
    // The box ends where the cursor last was over the map.
    const onUp = () => {
      if (!drawingRef.current) return;
      drawingRef.current = false;
      L.DomUtil.enableTextSelection();
      const start = startRef.current;
      const end = lastRef.current;
      if (!start || !end) return;
      const a = map.latLngToContainerPoint(start);
      const b = map.latLngToContainerPoint(end);
      if (Math.abs(a.x - b.x) < MIN_BOX_PX || Math.abs(a.y - b.y) < MIN_BOX_PX) {
        clearRect();
        setBounds(null);
      }
    };
    map.on("mousedown", onDown);
    map.on("mousemove", onMove);
    // Capture phase, so nothing on the page can stop the release reaching it.
    window.addEventListener("mouseup", onUp, true);
    return () => {
      map.off("mousedown", onDown);
      map.off("mousemove", onMove);
      window.removeEventListener("mouseup", onUp, true);
      if (drawingRef.current) {
        drawingRef.current = false;
        L.DomUtil.enableTextSelection();
      }
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

  return (
    // Click-through wrapper so it never intercepts a draw mousedown; the inner control is
    // kept from the map by the disableClickPropagation effect above.
    <div className="leaflet-top leaflet-right" style={{ pointerEvents: "none" }}>
      <div
        ref={controlRef}
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
              {onViewSamples ? (
                <button
                  type="button"
                  onClick={() => onViewSamples(bounds)}
                  className="rounded-sm bg-foreground px-2 py-1 text-[11px] font-medium text-background"
                >
                  View samples →
                </button>
              ) : null}
              {onViewBgcs ? (
                <button
                  type="button"
                  onClick={() => onViewBgcs(bounds)}
                  // The primary style when it is the only action (a family's map).
                  className={onViewSamples
                    ? "rounded-sm border border-border px-2 py-1 text-[11px] font-medium text-foreground"
                    : "rounded-sm bg-foreground px-2 py-1 text-[11px] font-medium text-background"}
                >
                  View BGCs →
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
