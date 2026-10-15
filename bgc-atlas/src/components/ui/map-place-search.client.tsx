"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";

// Photon (OSM geocoder) is queried from the browser: debounced, 5 results, and each keystroke
// aborts the previous request, to stay within the public instance's fair use.

const PHOTON_URL = "https://photon.komoot.io/api/";
const DEBOUNCE_MS = 300;
const MIN_QUERY_LEN = 2;
const RESULT_LIMIT = 5;
const MAP_MAX_ZOOM = 13; // must not exceed DotsMap's maxZoom

interface PhotonProps {
  name?: string;
  street?: string;
  housenumber?: string;
  city?: string;
  district?: string;
  county?: string;
  state?: string;
  country?: string;
  countrycode?: string;
  type?: string;
  osm_id?: number;
  osm_key?: string;
  osm_value?: string;
  extent?: [number, number, number, number]; // [minLon, maxLat, maxLon, minLat]
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] }; // [lon, lat]
  properties: PhotonProps;
}

function zoomForPlaceType(type: string | undefined): number {
  switch (type) {
    case "country":
      return 5;
    case "state":
    case "region":
      return 7;
    case "county":
      return 8;
    case "city":
      return 11;
    case "district":
    case "locality":
      return 12;
    case "street":
      return 14;
    case "house":
      return 16;
    default:
      return 12;
  }
}

// Photon extent is [minLon, maxLat, maxLon, minLat]; Leaflet wants [[south, west], [north, east]].
function extentToBounds(
  extent: [number, number, number, number]
): L.LatLngBoundsLiteral {
  const [west, north, east, south] = extent;
  return [
    [south, west],
    [north, east],
  ];
}

function primaryLabel(p: PhotonProps): string {
  return (
    p.name ||
    (p.street
      ? p.housenumber
        ? `${p.street} ${p.housenumber}`
        : p.street
      : "") ||
    p.city ||
    p.country ||
    "Unnamed place"
  );
}

function contextLabel(p: PhotonProps, primary: string): string {
  const parts = [p.city, p.county, p.state, p.country];
  const seen = new Set<string>([primary]);
  const out: string[] = [];
  for (const part of parts) {
    if (part && !seen.has(part)) {
      seen.add(part);
      out.push(part);
    }
  }
  return out.join(", ");
}

/** SVG divIcon pin (avoids Leaflet's default marker PNGs). */
function buildPinIcon(): L.DivIcon {
  return L.divIcon({
    className: "bgc-place-pin",
    html: `
      <svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M13 0C6.096 0 0.5 5.596 0.5 12.5c0 8.75 12.5 21 12.5 21s12.5-12.25 12.5-21C25.5 5.596 19.904 0 13 0z"
              fill="#2563eb" stroke="#ffffff" stroke-width="1.75"/>
        <circle cx="13" cy="12.5" r="4.5" fill="#ffffff"/>
      </svg>`,
    iconSize: [26, 34],
    iconAnchor: [13, 34],
    tooltipAnchor: [0, -30],
  });
}

export function MapPlaceSearch() {
  const map = useMap();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PhotonFeature[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  // Keep clicks / scroll on the control from reaching the map (pan/zoom).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);
  }, []);

  // Dismiss suggestions on any outside interaction; capture phase so Leaflet's handlers
  // can't stop it.
  useEffect(() => {
    if (!open) return;

    const onOutsidePointer = (e: PointerEvent) => {
      const el = containerRef.current;
      if (el && !el.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onOutsidePointer, true);

    const closeOnMapMove = () => setOpen(false);
    map.on("movestart", closeOnMapMove);
    map.on("zoomstart", closeOnMapMove);

    return () => {
      document.removeEventListener("pointerdown", onOutsidePointer, true);
      map.off("movestart", closeOnMapMove);
      map.off("zoomstart", closeOnMapMove);
    };
  }, [open, map]);

  const clearMarker = useCallback(() => {
    if (markerRef.current) {
      markerRef.current.remove();
      markerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearMarker();
      abortRef.current?.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [clearMarker]);

  useEffect(() => {
    const q = query.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (q.length < MIN_QUERY_LEN) {
      abortRef.current?.abort();
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    debounceRef.current = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setError(null);

      const url = `${PHOTON_URL}?q=${encodeURIComponent(
        q
      )}&limit=${RESULT_LIMIT}&lang=en`;

      fetch(url, { signal: controller.signal })
        .then((res) => {
          if (!res.ok) throw new Error(`Photon ${res.status}`);
          return res.json();
        })
        .then((data: { features?: PhotonFeature[] }) => {
          const features = (data.features ?? []).filter(
            (f) => Array.isArray(f?.geometry?.coordinates)
          );
          setResults(features);
          setActiveIndex(-1);
          setOpen(true);
          setLoading(false);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setResults([]);
          setError("Couldn't reach the search service");
          setLoading(false);
          setOpen(true);
        });
    }, DEBOUNCE_MS);
  }, [query]);

  const handleSelect = useCallback(
    (feature: PhotonFeature) => {
      const [lon, lat] = feature.geometry.coordinates;
      const p = feature.properties;
      const label = primaryLabel(p);

      if (p.extent) {
        map.flyToBounds(extentToBounds(p.extent), {
          maxZoom: MAP_MAX_ZOOM,
          padding: [40, 40],
          duration: 0.8,
        });
      } else {
        const zoom = Math.min(MAP_MAX_ZOOM, zoomForPlaceType(p.type));
        map.flyTo([lat, lon], zoom, { duration: 0.8 });
      }

      clearMarker();
      const marker = L.marker([lat, lon], {
        icon: buildPinIcon(),
        keyboard: false,
        interactive: false,
      }).addTo(map);
      const tip = contextLabel(p, label);
      marker.bindTooltip(tip ? `${label} · ${tip}` : label, {
        direction: "top",
      });
      markerRef.current = marker;

      setQuery(label);
      setOpen(false);
      setActiveIndex(-1);
    },
    [map, clearMarker]
  );

  const handleClear = useCallback(() => {
    setQuery("");
    setResults([]);
    setOpen(false);
    setError(null);
    setActiveIndex(-1);
    clearMarker();
  }, [clearMarker]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (results.length === 0) return;
      setOpen(true);
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length === 0) return;
      setOpen(true);
      setActiveIndex((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const idx = activeIndex >= 0 ? activeIndex : 0;
      const feature = results[idx];
      if (feature) handleSelect(feature);
    } else if (e.key === "Escape") {
      if (open) setOpen(false);
      else handleClear();
    }
  };

  const showDropdown =
    open && (loading || error !== null || results.length > 0);

  return (
    // Click-through wrapper; only the inner control is interactive.
    <div
      className="leaflet-top leaflet-right"
      style={{ pointerEvents: "none" }}
    >
      <div
        ref={containerRef}
        className="leaflet-control m-2"
        style={{ pointerEvents: "auto" }}
      >
        <div className="relative w-52 sm:w-64">
          <div className="flex items-center gap-1.5 rounded-sm border border-border bg-card/95 px-2.5 py-1.5 shadow-sm">
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className="size-3.5 shrink-0 text-muted-foreground"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => {
                if (results.length > 0 || error) setOpen(true);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Search place…"
              aria-label="Search for a place on the map"
              className="w-full bg-transparent text-[12.5px] text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            {query ? (
              <button
                type="button"
                onClick={handleClear}
                aria-label="Clear search"
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  className="size-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            ) : null}
          </div>

          {showDropdown ? (
            <ul
              className="absolute right-0 top-full z-[1300] mt-1 w-full overflow-hidden rounded-sm border border-border bg-popover text-popover-foreground shadow-[0_4px_16px_-8px_rgba(0,0,0,0.15)]"
              role="listbox"
            >
              {loading ? (
                <li className="px-2.5 py-2 text-[11.5px] text-muted-foreground">
                  Searching…
                </li>
              ) : error ? (
                <li className="px-2.5 py-2 text-[11.5px] text-muted-foreground">
                  {error}
                </li>
              ) : (
                results.map((feature, idx) => {
                  const p = feature.properties;
                  const label = primaryLabel(p);
                  const context = contextLabel(p, label);
                  const isActive = idx === activeIndex;
                  return (
                    <li key={`${p.osm_id ?? idx}-${idx}`} role="option" aria-selected={isActive}>
                      <button
                        type="button"
                        onClick={() => handleSelect(feature)}
                        onMouseEnter={() => setActiveIndex(idx)}
                        className={[
                          "flex w-full flex-col items-start gap-0.5 px-2.5 py-1.5 text-left",
                          isActive ? "bg-muted" : "hover:bg-muted",
                        ].join(" ")}
                      >
                        <span className="truncate text-[12.5px] font-medium text-foreground">
                          {label}
                        </span>
                        {context ? (
                          <span className="truncate text-[10.5px] text-muted-foreground">
                            {context}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}
