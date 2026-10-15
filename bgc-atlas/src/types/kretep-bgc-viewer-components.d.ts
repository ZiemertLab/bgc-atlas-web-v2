// `@kretep/bgc-viewer-components` (v0.2.1) declares `types` but ships no `.d.ts`.
// Revisit on version bump.
declare module "@kretep/bgc-viewer-components" {
  export interface JSONFileProviderOptions {
    records?: unknown[];
    pfamColorMap?: Record<string, string>;
  }

  export class JSONFileProvider {
    constructor(options?: JSONFileProviderOptions);
    loadFromFile(file: File | string): Promise<void>;
  }

  // Only the members `viewer-patches.ts` touches.
  export class TrackViewer {
    containerElement: HTMLElement;
    config: {
      width: number;
      height: number;
      margin: { top: number; right: number; bottom: number; left: number };
    };
    xAxisGroup: import("d3-selection").Selection<
      SVGGElement,
      unknown,
      null,
      undefined
    >;
    /** Read at construction and on every `resize()`. */
    calculateResponsiveWidth(): number;
    /** Runs on each zoom frame. */
    drawTracks(): void;
  }

  // Importing the module also registers the custom elements.
}
