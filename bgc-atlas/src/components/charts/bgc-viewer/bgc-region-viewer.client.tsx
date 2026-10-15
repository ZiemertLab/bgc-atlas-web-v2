"use client";

import { createElement, useEffect, useRef, useState } from "react";
// Importing the package registers the <bgc-region-viewer-container> custom element.
import { JSONFileProvider } from "@kretep/bgc-viewer-components";

import { apiFetch, withBase } from "@/lib/basePath";
import { applyViewerPatches } from "./viewer-patches";
import { VIEWER_MOBILE_CSS } from "./viewer-mobile-css";

// Must run before the custom element is rendered so TrackViewer gets the patched sizing.
applyViewerPatches();

interface BgcRegionViewerProps {
  bgcId: string;
}

interface AntismashRecord {
  id?: string;
}

interface AntismashData {
  records?: AntismashRecord[];
}

function parsePfamColorMap(csv: string): Record<string, string> {
  const map: Record<string, string> = {};
  const lines = csv.split(/\r?\n/);
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    const comma = line.indexOf(",");
    if (comma === -1) continue;
    const id = line.slice(0, comma).trim();
    const color = line.slice(comma + 1).trim();
    if (id && color) map[id] = color;
  }
  return map;
}

// The global stylesheet cannot reach the viewer's shadow root; without this
// injection gene/domain colours are missing.
function injectShadowStyles(host: HTMLElement, cssText: string): boolean {
  const root = host.shadowRoot;
  if (!root) return false;
  if (root.querySelector("style[data-bgc-viewer-injected]")) return true;
  const style = document.createElement("style");
  style.setAttribute("data-bgc-viewer-injected", "");
  style.textContent = cssText;
  root.appendChild(style);
  return true;
}

// Library bug (v0.2.1): its document click handler checks `event.target.closest(...)`,
// but shadow-DOM retargeting makes dropdown clicks look "outside", closing it as it opens.
function keepDropdownClicksInShadow(host: HTMLElement): () => void {
  const handler = (event: Event) => {
    const insideDropdown = event
      .composedPath()
      .some((el) => el instanceof Element && el.classList.contains("multi-select-dropdown"));
    if (insideDropdown) event.stopPropagation();
  };
  host.addEventListener("click", handler);
  return () => host.removeEventListener("click", handler);
}

const AXIS_LOCK_SLOP_PX = 6;

// d3-zoom preventDefault()s every touch move, so a phone cannot scroll past the
// viewer. Capture-phase listeners commit one-finger drags to an axis: vertical goes
// to the page, horizontal to d3; two-finger pinch is untouched.
function lockGestureAxis(host: HTMLElement): () => void {
  let start: { x: number; y: number } | null = null;
  let axis: "x" | "y" | null = null;

  const reset = () => {
    start = null;
    axis = null;
  };

  const onStart = (event: TouchEvent) => {
    const overChart = event
      .composedPath()
      .some((el) => el instanceof SVGSVGElement);
    if (!overChart || event.touches.length !== 1) {
      reset();
      return;
    }
    start = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    axis = null;
  };

  const onMove = (event: TouchEvent) => {
    if (!start) return;
    if (event.touches.length > 1) {
      reset();
      return;
    }
    if (!axis) {
      const dx = Math.abs(event.touches[0].clientX - start.x);
      const dy = Math.abs(event.touches[0].clientY - start.y);
      if (Math.max(dx, dy) < AXIS_LOCK_SLOP_PX) {
        event.stopPropagation();
        return;
      }
      axis = dy > dx ? "y" : "x";
    }
    if (axis === "y") event.stopPropagation();
  };

  host.addEventListener("touchstart", onStart, { capture: true });
  host.addEventListener("touchmove", onMove, { capture: true });
  host.addEventListener("touchend", reset, { capture: true });
  host.addEventListener("touchcancel", reset, { capture: true });

  return () => {
    host.removeEventListener("touchstart", onStart, { capture: true });
    host.removeEventListener("touchmove", onMove, { capture: true });
    host.removeEventListener("touchend", reset, { capture: true });
    host.removeEventListener("touchcancel", reset, { capture: true });
  };
}

// The viewer (v0.2.1) hardcodes `showTrackLabels: false`; clicking its own
// light-DOM menu item while unchecked is the only way to turn labels on.
function enableTrackLabelsByDefault(): boolean {
  const items = Array.from(
    document.querySelectorAll<HTMLElement>(".track-viewer-menu-item"),
  ).filter((el) => (el.textContent ?? "").includes("Show track labels"));
  if (items.length === 0) return false;
  for (const item of items) {
    const checkbox = item.querySelector(".menu-checkbox");
    const isChecked = !!checkbox && (checkbox.textContent ?? "").trim() !== "";
    if (!isChecked) {
      item.dispatchEvent(new MouseEvent("click", { bubbles: false }));
    }
  }
  return true;
}

const ZOOM_TARGET = 0.85;

// Preparing a region can take minutes on the largest runs (multi-GB archive, ~15GB results JSON).
const PREPARE_POLL_MS = 4000;
const PREPARE_TIMEOUT_MS = 10 * 60 * 1000;

// The library pads the x-domain by only ~2% and clips, cutting off edge genes, and
// exposes no zoom option. Wheel events drive its d3-zoom out to ZOOM_TARGET.
function applyDefaultZoomOut(host: HTMLElement): boolean {
  const svg = host.shadowRoot?.querySelector("svg");
  if (!svg) return false;
  const rect = svg.getBoundingClientRect();
  if (rect.width === 0) return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const currentK = (svg as any).__zoom?.k;
  if (typeof currentK !== "number") return false;
  // Only act on the initial identity view, never on a scale the user changed.
  if (currentK < 0.999) return true;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  for (let i = 0; i < 20; i += 1) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const k = (svg as any).__zoom?.k;
    if (typeof k === "number" && k <= ZOOM_TARGET) break;
    svg.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 30,
        clientX: cx,
        clientY: cy,
        bubbles: true,
        cancelable: true,
      }),
    );
  }
  return true;
}

export function BgcRegionViewer({ bgcId }: BgcRegionViewerProps) {
  const hostRef = useRef<HTMLElement | null>(null);
  const [status, setStatus] = useState<
    "loading" | "preparing" | "ready" | "error" | "empty"
  >("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [prepareStage, setPrepareStage] = useState<"extracting" | "trimming" | null>(null);

  useEffect(() => {
    let cancelled = false;
    let detachDropdownFix: (() => void) | null = null;
    let detachGestureLock: (() => void) | null = null;
    setStatus("loading");
    setErrorMessage(null);
    setPrepareStage(null);

    // A 202 means the server is still preparing the region; poll until it is ready.
    const fetchRegionJson = async (): Promise<AntismashData> => {
      const deadline = Date.now() + PREPARE_TIMEOUT_MS;
      for (;;) {
        const res = await apiFetch(`/api/bgcs/${bgcId}/antismash-json`);

        if (res.status === 202) {
          const body = await res.json().catch(() => ({}));
          if (cancelled) throw new Error("cancelled");
          setPrepareStage(body?.stage === "extracting" ? "extracting" : "trimming");
          setStatus("preparing");
          if (Date.now() > deadline) {
            throw new Error(
              "Preparing this region is taking longer than expected. It is still running — please check back shortly.",
            );
          }
          await new Promise((resolve) => setTimeout(resolve, PREPARE_POLL_MS));
          continue;
        }

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `Failed to load antiSMASH data (HTTP ${res.status})`);
        }

        return (await res.json()) as AntismashData;
      }
    };

    (async () => {
      try {
        const [data, cssText, csvText] = await Promise.all([
          fetchRegionJson(),
          fetch(withBase("/vendor/bgc-viewer/style.css")).then((r) => (r.ok ? r.text() : "")),
          fetch(withBase("/vendor/bgc-viewer/domain-colors.csv")).then((r) => (r.ok ? r.text() : "")),
        ]);

        if (cancelled) return;

        const records = data.records ?? [];
        const recordId = records[0]?.id;
        if (!recordId) {
          setStatus("empty");
          return;
        }

        const host = hostRef.current;
        if (!host) return;

        // Inject before handing over the data: the left margin is measured from
        // label text on first draw, so the mobile font override must already apply.
        const styleText = [cssText, VIEWER_MOBILE_CSS].filter(Boolean).join("\n");
        if (!injectShadowStyles(host, styleText)) {
          let attempts = 0;
          const tryInject = () => {
            if (cancelled) return;
            if (injectShadowStyles(host, styleText) || attempts > 60) return;
            attempts += 1;
            requestAnimationFrame(tryInject);
          };
          requestAnimationFrame(tryInject);
        }

        const pfamColorMap = csvText ? parsePfamColorMap(csvText) : {};
        const provider = new JSONFileProvider({ records, pfamColorMap });

        // No clusterblast/MiBIG data: getMiBIGEntries throws, which the panel surfaces as an error.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const origGetMiBIG = (provider as any).getMiBIGEntries.bind(provider);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (provider as any).getMiBIGEntries = async (...args: unknown[]) => {
          try {
            return await origGetMiBIG(...args);
          } catch {
            return { entries: [], count: 0 };
          }
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (host as any).dataProvider = provider;
        host.setAttribute("record-id", recordId);

        detachDropdownFix = keepDropdownClicksInShadow(host);
        detachGestureLock = lockGestureAxis(host);

        if (!enableTrackLabelsByDefault()) {
          let labelAttempts = 0;
          const tryEnableLabels = () => {
            if (cancelled) return;
            if (enableTrackLabelsByDefault() || labelAttempts > 300) return;
            labelAttempts += 1;
            requestAnimationFrame(tryEnableLabels);
          };
          requestAnimationFrame(tryEnableLabels);
        }

        if (!applyDefaultZoomOut(host)) {
          let zoomAttempts = 0;
          const tryZoomOut = () => {
            if (cancelled) return;
            if (applyDefaultZoomOut(host) || zoomAttempts > 300) return;
            zoomAttempts += 1;
            requestAnimationFrame(tryZoomOut);
          };
          requestAnimationFrame(tryZoomOut);
        }

        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        setErrorMessage(err instanceof Error ? err.message : "Unable to load viewer");
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      detachDropdownFix?.();
      detachGestureLock?.();
    };
  }, [bgcId]);

  // The host must keep a non-zero width for the viewer's ResizeObserver; status renders as an overlay.
  return (
    <section className="relative border border-border bg-card">
      {status !== "ready" && (
        <div className="absolute inset-0 z-10 flex min-h-[160px] items-center justify-center bg-card px-4 text-center text-sm text-muted-foreground">
          {status === "loading" && "Loading viewer…"}
          {status === "preparing" && (
            <span>
              {prepareStage === "extracting"
                ? "Unpacking this sample's antiSMASH results…"
                : "Preparing this region…"}
              <br />
              <span className="text-[11.5px]">
                First view of a large sample can take a few minutes. This updates automatically.
              </span>
            </span>
          )}
          {status === "error" && (errorMessage ?? "Unable to load the cluster viewer.")}
          {status === "empty" && "No antiSMASH region data available for this BGC."}
        </div>
      )}
      <div className="p-2">
        {createElement("bgc-region-viewer-container", {
          ref: hostRef,
          style: { display: "block", minHeight: "300px" },
        })}
      </div>
    </section>
  );
}
