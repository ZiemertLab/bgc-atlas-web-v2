import { TrackViewer } from "@kretep/bgc-viewer-components";

// The library (v0.2.1) sizes its SVG with `Math.max(600, container - 40)`, clipping the axis on phones.
// Its constructor and resize() both call this method. Below 300px the tick labels collide.
const MIN_CHART_WIDTH = 300;

const TICK_LABEL_GAP_PX = 8;

let applied = false;

/** Must run before the custom element constructs its TrackViewer. */
export function applyViewerPatches(): void {
  if (applied) return;
  applied = true;

  TrackViewer.prototype.calculateResponsiveWidth = function (this: TrackViewer) {
    return Math.max(MIN_CHART_WIDTH, (this.containerElement?.clientWidth || 800) - 40);
  };

  // d3 draws ~10 ticks regardless of width and a tick count is only a hint, so measure the drawn labels
  // and keep every Nth tick. Seven-digit coordinates collide even at 768px.
  const drawTracks = TrackViewer.prototype.drawTracks;
  TrackViewer.prototype.drawTracks = function (this: TrackViewer) {
    drawTracks.call(this);

    const ticks = this.xAxisGroup.selectAll<SVGGElement, unknown>(".tick").nodes();
    if (ticks.length < 2) return;

    // Un-hide before measuring: a display:none tick reports a zero-width box.
    for (const tick of ticks) tick.style.display = "";
    const labels = ticks.map((tick) => tick.querySelector("text")?.getBoundingClientRect());
    if (!labels[0] || !labels[1]) return;

    // d3 spaces ticks evenly, so one gap is the pitch for all of them.
    const pitch = Math.abs(
      (labels[1].left + labels[1].right) / 2 - (labels[0].left + labels[0].right) / 2,
    );
    if (pitch <= 0) return;

    const widest = Math.max(...labels.map((label) => label?.width ?? 0));
    const stride = Math.max(1, Math.ceil((widest + TICK_LABEL_GAP_PX) / pitch));
    // Drop whole strides so surviving labels stay evenly spaced.
    if (stride > 1) ticks.forEach((tick, i) => { if (i % stride !== 0) tick.style.display = "none"; });
  };
}
